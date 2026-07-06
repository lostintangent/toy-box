import type { CustomArtifactKind, DraftPrompt, DraftSession, WorkspaceEvent } from "@/types";

export type WorkspaceState = {
  drafts: DraftSession[];
  draftPromptsBySessionId: Record<string, DraftPrompt>;
  unreadSessionIds: string[];
  hyperSessionIds: string[];
  // User-registered artifact viewers, loaded from `~/.toy-box/artifacts/`. Carried
  // in workspace state (not a dedicated endpoint) so the client learns about custom
  // kinds through the same hydrate-once + refetch-on-focus plane as everything else.
  // Passive data: no reducer case mutates it, and every reducer spreads `...state`,
  // so it rides through untouched and is only refreshed by a server snapshot.
  customArtifacts: CustomArtifactKind[];
  // Projection of active streams. The server snapshot + broadcasts are
  // authoritative; the client writes optimistically only for its own actions
  // (running on send; idle on explicit stop or a failed send). Turn-end idle is
  // left to the server broadcast — a client must never clear running from a
  // passive/observational stream completion, or a second instance watching the
  // same session (e.g. the overlay) would clobber a still-running sibling.
  runningSessionIds: string[];
};

export function createEmptyWorkspaceState(): WorkspaceState {
  return {
    drafts: [],
    draftPromptsBySessionId: {},
    unreadSessionIds: [],
    hyperSessionIds: [],
    runningSessionIds: [],
    customArtifacts: [],
  };
}

export function reduceWorkspaceState(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
  switch (event.type) {
    case "session.draft.created":
      return upsertDraft(state, event.draft);
    case "session.draft.discarded":
      return removeDiscardedDraft(state, event.sessionId);
    case "session.prompt.drafted":
      return setDraftPrompt(state, event.sessionId, event.prompt);
    case "session.hyper.created":
      return updateSessionIdMembership(state, "hyperSessionIds", event.sessionId, true);
    case "session.hyper.promoted":
      return updateSessionIdMembership(state, "hyperSessionIds", event.sessionId, false);
    case "session.running":
      return updateSessionIdMembership(state, "runningSessionIds", event.sessionId, true);
    case "session.idle":
      return updateSessionIdMembership(state, "runningSessionIds", event.sessionId, false);
    case "session.unread":
      return updateSessionIdMembership(state, "unreadSessionIds", event.sessionId, true);
    case "session.read":
      return updateSessionIdMembership(state, "unreadSessionIds", event.sessionId, false);
    case "session.deleted":
      return removeDeletedSession(state, event.sessionId);
    case "session.upserted":
      return removeDraftMembership(state, event.session.sessionId);
  }
}

export function selectDraftPrompt(state: WorkspaceState, sessionId: string): DraftPrompt | null {
  return state.draftPromptsBySessionId[sessionId] ?? null;
}

function upsertDraft(state: WorkspaceState, draft: DraftSession): WorkspaceState {
  const index = state.drafts.findIndex((item) => item.sessionId === draft.sessionId);
  if (index === -1) {
    return { ...state, drafts: [...state.drafts, draft] };
  }

  if (areDraftsEqual(state.drafts[index], draft)) return state;

  const drafts = [...state.drafts];
  drafts[index] = draft;
  return { ...state, drafts };
}

function setDraftPrompt(
  state: WorkspaceState,
  sessionId: string,
  prompt: DraftPrompt,
): WorkspaceState {
  const existing = state.draftPromptsBySessionId[sessionId];
  if (existing && areDraftPromptsEqual(existing, prompt)) return state;

  return {
    ...state,
    draftPromptsBySessionId: {
      ...state.draftPromptsBySessionId,
      [sessionId]: prompt,
    },
  };
}

function removeDiscardedDraft(state: WorkspaceState, sessionId: string): WorkspaceState {
  let next = removeDraftMembership(state, sessionId);
  next = removeDraftPrompt(next, sessionId);
  return updateSessionIdMembership(next, "hyperSessionIds", sessionId, false);
}

function removeDeletedSession(state: WorkspaceState, sessionId: string): WorkspaceState {
  let next = removeDraftMembership(state, sessionId);
  next = removeDraftPrompt(next, sessionId);
  next = updateSessionIdMembership(next, "unreadSessionIds", sessionId, false);
  next = updateSessionIdMembership(next, "hyperSessionIds", sessionId, false);
  return updateSessionIdMembership(next, "runningSessionIds", sessionId, false);
}

function removeDraftMembership(state: WorkspaceState, sessionId: string): WorkspaceState {
  const drafts = state.drafts.filter((draft) => draft.sessionId !== sessionId);
  return drafts.length === state.drafts.length ? state : { ...state, drafts };
}

function removeDraftPrompt(state: WorkspaceState, sessionId: string): WorkspaceState {
  if (!(sessionId in state.draftPromptsBySessionId)) return state;

  const { [sessionId]: _, ...draftPromptsBySessionId } = state.draftPromptsBySessionId;
  return { ...state, draftPromptsBySessionId };
}

function updateSessionIdMembership(
  state: WorkspaceState,
  key: "unreadSessionIds" | "hyperSessionIds" | "runningSessionIds",
  sessionId: string,
  present: boolean,
): WorkspaceState {
  const list = state[key];
  const hasSessionId = list.includes(sessionId);
  if (present === hasSessionId) return state;

  return {
    ...state,
    [key]: present ? [...list, sessionId] : list.filter((id) => id !== sessionId),
  };
}

function areDraftsEqual(a: DraftSession, b: DraftSession): boolean {
  return a.sessionId === b.sessionId && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt;
}

function areDraftPromptsEqual(a: DraftPrompt, b: DraftPrompt): boolean {
  return a.text === b.text && a.origin === b.origin && a.updatedAt === b.updatedAt;
}
