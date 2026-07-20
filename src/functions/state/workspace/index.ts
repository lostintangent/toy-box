// Authoritative server boundary for workspace-wide facts outside transcripts.

import type {
  Automation,
  ArtifactWorker,
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
  finishArtifactWorker as finishArtifactWorkerState,
  finishArtifactWorkersForSession,
  getArtifactWorker,
  getArtifactWorkers,
  hasArtifactWorker,
  startArtifactWorker as startArtifactWorkerState,
} from "./artifactWorkers";

export { loadCustomArtifacts, normalizeExtensions } from "./artifacts";
export { getEnvironment } from "./environment";

export async function getWorkspaceState(options: {
  automations: Automation[];
  customArtifacts: CustomArtifactKind[];
  environment: WorkspaceEnvironment;
}): Promise<WorkspaceState> {
  return {
    sessionStates: getSessionStates(),
    hyperSessionIds: getHyperSessionIds(),
    automations: options.automations,
    inboxEntries: await getInboxEntries(),
    artifactWorkers: getArtifactWorkers(),
    customArtifacts: options.customArtifacts,
    environment: options.environment,
  };
}

export function sweepExpiredDrafts(now: number = Date.now()): string[] {
  const expiredSessionIds = sweepDraftSessionStates(now);
  for (const sessionId of expiredSessionIds) {
    deleteHyperState(sessionId);
    broadcast({ type: "session.draft.discarded", sessionId });
  }
  return expiredSessionIds;
}

/** Complete the draft-to-session handoff before publishing the session upsert. */
export function promoteDraftSession(sessionId: string): void {
  applySessionState({ type: "session.upserted", session: { sessionId } });
}

export function deleteSessionWorkspaceState(sessionId: string): void {
  applySessionState({ type: "session.deleted", sessionId });
  deleteHyperState(sessionId);
  for (const workerSessionId of finishArtifactWorkersForSession(sessionId)) {
    broadcast({ type: "artifact.worker.finished", sessionId: workerSessionId });
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

export function startArtifactWorker(worker: ArtifactWorker): void {
  if (!startArtifactWorkerState(worker)) return;
  broadcast({ type: "artifact.worker.started", worker });
}

export function finishArtifactWorker(sessionId: string): void {
  if (!finishArtifactWorkerState(sessionId)) return;
  broadcast({ type: "artifact.worker.finished", sessionId });
}

export { getArtifactWorker, hasArtifactWorker };

export async function registerArtifactKind(kind: CustomArtifactKind): Promise<void> {
  await writeCustomArtifact(kind);
  broadcast({ type: "artifact.kind.registered", kind });
}

export function applyWorkspaceAction(action: WorkspaceAction): void {
  let event: WorkspaceEvent | undefined;

  switch (action.type) {
    case "session.draft.created": {
      if (isDraft(action.sessionId)) break;
      event = { ...action, createdAt: Date.now() };
      if (!applySessionState(event)) {
        event = undefined;
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

  if (event) broadcast(event);
}
