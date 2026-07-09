// Authoritative server boundary for workspace-wide facts outside transcripts.

import type {
  ArtifactCommentSession,
  CustomArtifactKind,
  InboxEntry,
  WorkspaceAction,
  WorkspaceEvent,
} from "@/types";
import { DRAFT_PROMPT_SERVER_ORIGIN } from "@/lib/session/constants";
import type { WorkspaceEnvironment, WorkspaceState } from "@/lib/workspace/state";
import { broadcast } from "@/functions/runtime/broadcast";
import { addHyperSession, deleteHyperState, getHyperSessionIds } from "./hyperSessions";
import {
  completeInboxEntry,
  createInboxEntry,
  deleteInboxEntryState,
  getInboxEntries,
  hasInboxEntry,
} from "./inbox";
import {
  applySessionState,
  getSessionState,
  getSessionStates,
  isDraft,
  setSessionPrompt,
  sweepExpiredDrafts as sweepDraftSessionStates,
} from "./sessions";
import { writeCustomArtifact } from "./artifacts";
import {
  deleteArtifactCommentSession,
  deleteArtifactCommentSessionsForSession,
  getArtifactCommentSessions,
  hasArtifactCommentSession,
  setArtifactCommentSession,
} from "./commentSessions";

export { loadCustomArtifacts, normalizeExtensions } from "./artifacts";
export { getEnvironment } from "./environment";

export async function getWorkspaceState(options: {
  customArtifacts: CustomArtifactKind[];
  environment: WorkspaceEnvironment;
}): Promise<WorkspaceState> {
  return {
    sessionStates: getSessionStates(),
    hyperSessionIds: getHyperSessionIds(),
    inboxEntries: await getInboxEntries(),
    artifactCommentSessions: getArtifactCommentSessions(),
    customArtifacts: options.customArtifacts,
    environment: options.environment,
  };
}

export function sweepExpiredDrafts(now: number = Date.now()): string[] {
  const expiredSessionIds = sweepDraftSessionStates(now);
  for (const sessionId of expiredSessionIds) deleteHyperState(sessionId);
  return expiredSessionIds;
}

/** Complete the draft-to-session handoff before publishing the session upsert. */
export function promoteDraftSession(sessionId: string): void {
  applySessionState({ type: "session.upserted", session: { sessionId } });
}

export function deleteSessionWorkspaceState(sessionId: string): void {
  applySessionState({ type: "session.deleted", sessionId });
  deleteHyperState(sessionId);
  for (const commentSessionId of deleteArtifactCommentSessionsForSession(sessionId)) {
    broadcast({ type: "artifact.comment_session.unlinked", sessionId: commentSessionId });
  }
}

export function setSessionStatus(
  sessionId: string,
  status: "creating" | "running" | "idle" | "unread",
): void {
  const event = { type: `session.${status}`, sessionId } as const;
  if (applySessionState(event)) broadcast(event);
}

export function clearDraftPrompt(sessionId: string): void {
  if (!getSessionState(sessionId)?.prompt?.text) return;
  const prompt = setSessionPrompt(sessionId, "", DRAFT_PROMPT_SERVER_ORIGIN);
  if (prompt) broadcast({ type: "session.prompt.drafted", sessionId, prompt });
}

export async function createPendingInboxEntry(sessionId: string): Promise<InboxEntry> {
  const entry = await createInboxEntry(sessionId);
  setSessionStatus(sessionId, "running");
  broadcast({ type: "inbox.entry.upserted", entry });
  return entry;
}

export async function sendToInbox(
  sessionId: string,
  message: string,
  artifact?: { filename: string; content: string },
): Promise<InboxEntry> {
  const entry = await completeInboxEntry(sessionId, message, artifact);
  broadcast({ type: "inbox.entry.upserted", entry });
  return entry;
}

export async function deleteInboxEntry(entryId: string): Promise<boolean> {
  if (!(await hasInboxEntry(entryId))) return false;
  const deleted = await deleteInboxEntryState(entryId);
  if (deleted) broadcast({ type: "inbox.entry.deleted", entryId });
  return deleted;
}

export function linkArtifactCommentSession(commentSession: ArtifactCommentSession): void {
  setArtifactCommentSession(commentSession);
  broadcast({ type: "artifact.comment_session.linked", commentSession });
}

export function unlinkArtifactCommentSession(sessionId: string): void {
  if (!deleteArtifactCommentSession(sessionId)) return;
  broadcast({ type: "artifact.comment_session.unlinked", sessionId });
}

export { hasArtifactCommentSession };

export async function registerArtifactKind(kind: CustomArtifactKind): Promise<void> {
  await writeCustomArtifact(kind);
  broadcast({ type: "artifact.kind.registered", kind });
}

export function applyWorkspaceAction(action: WorkspaceAction): void {
  let event: WorkspaceEvent | null = null;

  switch (action.type) {
    case "session.draft.created": {
      if (isDraft(action.sessionId)) break;
      event = { ...action, createdAt: Date.now() };
      if (!applySessionState(event)) {
        event = null;
        break;
      }
      if (action.hyper) addHyperSession(action.sessionId);
      break;
    }
    case "session.draft.discarded":
      if (getSessionState(action.sessionId)?.status !== "draft") break;
      applySessionState(action);
      deleteHyperState(action.sessionId);
      event = action;
      break;
    case "session.prompt.drafted": {
      const prompt = setSessionPrompt(action.sessionId, action.prompt.text, action.prompt.origin);
      if (prompt) event = { ...action, prompt };
      break;
    }
    case "session.hyper.promoted":
      if (deleteHyperState(action.sessionId)) event = action;
      break;
    case "session.read":
      if (applySessionState(action)) event = action;
      break;
  }

  broadcast(event);
}
