// Server workspace state.
//
// This module is the public boundary for process-local workspace coordination:
// drafts, draft prompts, unread membership, hyper membership, and the disk-backed
// custom artifact kinds. Subfiles in this folder are storage facets; callers import
// the domain verbs from here.

import type { CustomArtifactKind, DraftSession, WorkspaceAction } from "@/types";
import { DRAFT_PROMPT_SERVER_ORIGIN } from "@/lib/session/constants";
import type { WorkspaceState } from "@/lib/workspace/state";
import {
  emitDraftCreated,
  emitDraftDiscarded,
  emitDraftPromptChanged,
  emitSessionHyper,
  emitSessionPromoted,
  emitSessionRead,
  emitSessionUnread,
} from "@/functions/runtime/broadcast";
import {
  createDraftRecord,
  deleteDraftState,
  getDraft,
  getDrafts,
  isDraft,
  isDraftFresh,
  sweepExpiredDrafts as sweepDraftRecords,
  touchDraft,
} from "./drafts";
import {
  deleteDraftPromptState,
  getDraftPrompt,
  getDraftPromptsBySessionId,
  setDraftPromptRecord,
} from "./draftPrompts";
import { addHyperSession, deleteHyperState, getHyperSessionIds } from "./hyperSessions";
import { addUnreadSession, deleteUnreadState, getUnreadSessionIds } from "./unread";

export { getDrafts, isDraft, isDraftFresh, touchDraft };
export { deleteDraftState, deleteDraftPromptState, deleteHyperState, deleteUnreadState };
export { getDraftPrompt, getHyperSessionIds, getUnreadSessionIds };
export { loadCustomArtifacts, writeCustomArtifact, normalizeExtensions } from "./artifacts";

export function getWorkspaceState(options: {
  runningSessionIds: string[];
  customArtifacts: CustomArtifactKind[];
}): WorkspaceState {
  return {
    drafts: getDrafts(),
    draftPromptsBySessionId: getDraftPromptsBySessionId(),
    unreadSessionIds: getUnreadSessionIds(),
    hyperSessionIds: getHyperSessionIds(),
    runningSessionIds: options.runningSessionIds,
    customArtifacts: options.customArtifacts,
  };
}

export function createDraft(sessionId: string): DraftSession {
  const existing = getDraft(sessionId);
  if (existing) return existing;

  const draft = createDraftRecord(sessionId);
  emitDraftCreated(draft);
  return draft;
}

export function discardDraft(sessionId: string): void {
  if (!deleteDraftState(sessionId)) return;

  deleteDraftPromptState(sessionId);
  deleteHyperState(sessionId);
  emitDraftDiscarded(sessionId);
}

export function sweepExpiredDrafts(now: number = Date.now()): string[] {
  const expiredSessionIds = sweepDraftRecords(now);
  for (const sessionId of expiredSessionIds) {
    deleteDraftPromptState(sessionId);
    deleteHyperState(sessionId);
  }
  return expiredSessionIds;
}

export function deleteSessionWorkspaceState(sessionId: string): void {
  deleteDraftState(sessionId);
  deleteDraftPromptState(sessionId);
  deleteHyperState(sessionId);
  deleteUnreadState(sessionId);
}

export function setDraftPrompt(sessionId: string, text: string, origin: string): void {
  const existing = getDraftPrompt(sessionId);
  // Origin suppresses echoes for clients; text is the user-visible state.
  if (existing?.text === text) return;

  const prompt = setDraftPromptRecord(sessionId, text, origin);
  emitDraftPromptChanged(sessionId, prompt);
}

export function clearDraftPrompt(sessionId: string): void {
  const existing = getDraftPrompt(sessionId);
  if (!existing?.text) return;
  setDraftPrompt(sessionId, "", DRAFT_PROMPT_SERVER_ORIGIN);
}

export function markSessionRead(sessionId: string): void {
  if (!deleteUnreadState(sessionId)) return;
  emitSessionRead(sessionId);
}

export function markSessionUnread(sessionId: string): void {
  if (!addUnreadSession(sessionId)) return;
  emitSessionUnread(sessionId);
}

export function markSessionHyper(sessionId: string): void {
  if (!addHyperSession(sessionId)) return;
  emitSessionHyper(sessionId);
}

export function markSessionPromoted(sessionId: string): void {
  if (!deleteHyperState(sessionId)) return;
  emitSessionPromoted(sessionId);
}

// Client-issued actions are the write half of workspace coordination. Each handler
// performs one action's durable mutation and nothing more: the mutators it calls
// self-gate their own broadcasts, so a no-op stays silent without any bookkeeping
// here. Handlers return nothing — a command either applies or (in the future)
// throws; the client resyncs on a thrown error, never on a return value. The map
// is keyed by `WorkspaceAction["type"]`, so adding an action is a compile error
// until its handler exists.
type WorkspaceActionHandlers = {
  [Type in WorkspaceAction["type"]]: (action: Extract<WorkspaceAction, { type: Type }>) => void;
};

const workspaceActionHandlers: WorkspaceActionHandlers = {
  "session.draft.created": ({ draft }) => {
    createDraft(draft.sessionId);
  },
  "session.draft.discarded": ({ sessionId }) => discardDraft(sessionId),
  "session.prompt.drafted": ({ sessionId, prompt }) => {
    setDraftPrompt(sessionId, prompt.text, prompt.origin);
    touchDraft(sessionId);
  },
  "session.hyper.created": ({ sessionId }) => markSessionHyper(sessionId),
  "session.hyper.promoted": ({ sessionId }) => markSessionPromoted(sessionId),
  "session.read": ({ sessionId }) => markSessionRead(sessionId),
};

export function applyWorkspaceAction(action: WorkspaceAction): void {
  (workspaceActionHandlers[action.type] as (action: WorkspaceAction) => void)(action);
}
