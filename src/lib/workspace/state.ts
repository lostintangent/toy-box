import type {
  ArtifactCommentSession,
  CustomArtifactKind,
  DraftPrompt,
  InboxEntry,
  WorkspaceEvent,
} from "@/types";
import { DEFAULT_TERMINAL_WS_PORT } from "@/types";

/** Passive capabilities configured by the server process. */
export type WorkspaceEnvironment = {
  terminalWsPort: number;
  voiceEnabled: boolean;
};

/**
 * Shared lifecycle and composer state for one session. Missing means idle.
 * `creating` remains draft-backed while also counting as running to activity UI.
 */
export type WorkspaceSessionState =
  | { status: "draft" | "creating"; createdAt: number; prompt?: DraftPrompt }
  | { status: "running" | "unread"; prompt?: DraftPrompt }
  | { status: "idle"; prompt: DraftPrompt };

export function isWorkspaceSessionRunning(state: WorkspaceSessionState | undefined): boolean {
  return state?.status === "creating" || state?.status === "running";
}

export type WorkspaceSessionEvent = Extract<
  WorkspaceEvent,
  {
    type:
      | "session.draft.created"
      | "session.draft.discarded"
      | "session.prompt.drafted"
      | "session.creating"
      | "session.running"
      | "session.idle"
      | "session.unread"
      | "session.read"
      | "session.upserted"
      | "session.deleted";
  }
>;

export type WorkspaceState = {
  sessionStates: Record<string, WorkspaceSessionState>;
  hyperSessionIds: string[];
  inboxEntries: InboxEntry[];
  artifactCommentSessions: ArtifactCommentSession[];
  customArtifacts: CustomArtifactKind[];
  environment: WorkspaceEnvironment;
};

export function createEmptyWorkspaceState(): WorkspaceState {
  return {
    sessionStates: {},
    hyperSessionIds: [],
    inboxEntries: [],
    artifactCommentSessions: [],
    customArtifacts: [],
    environment: { terminalWsPort: DEFAULT_TERMINAL_WS_PORT, voiceEnabled: false },
  };
}

export function reduceWorkspaceState(state: WorkspaceState, event: WorkspaceEvent): WorkspaceState {
  switch (event.type) {
    case "session.draft.created": {
      const next = reduceSessionInWorkspace(state, event.sessionId, event);
      return event.hyper ? setHyperSessionMembership(next, event.sessionId, true) : next;
    }
    case "session.draft.discarded": {
      const next = reduceSessionInWorkspace(state, event.sessionId, event);
      return setHyperSessionMembership(next, event.sessionId, false);
    }
    case "session.deleted": {
      const next = reduceSessionInWorkspace(state, event.sessionId, event);
      const withoutHyper = setHyperSessionMembership(next, event.sessionId, false);
      return removeArtifactCommentSessionsForSession(withoutHyper, event.sessionId);
    }
    case "session.hyper.promoted":
      return setHyperSessionMembership(state, event.sessionId, false);
    case "inbox.entry.upserted":
      return upsertInboxEntry(state, event.entry);
    case "inbox.entry.deleted":
      return deleteInboxEntry(state, event.entryId);
    case "artifact.kind.registered":
      return registerArtifactKind(state, event.kind);
    case "artifact.comment_session.linked":
      return linkArtifactCommentSession(state, event.commentSession);
    case "artifact.comment_session.unlinked":
      return unlinkArtifactCommentSession(state, event.sessionId);
    case "session.prompt.drafted":
    case "session.creating":
    case "session.running":
    case "session.idle":
    case "session.unread":
    case "session.read":
      return reduceSessionInWorkspace(state, event.sessionId, event);
    case "session.upserted":
      return reduceSessionInWorkspace(state, event.session.sessionId, event);
  }
}

/** The canonical transition function shared by the server store and client projection. */
export function reduceWorkspaceSessionState(
  state: WorkspaceSessionState | undefined,
  event: WorkspaceSessionEvent,
): WorkspaceSessionState | undefined {
  switch (event.type) {
    case "session.draft.created":
      if (
        state?.status === "creating" ||
        state?.status === "running" ||
        state?.status === "unread"
      ) {
        return state;
      }
      if (state?.status === "draft" && state.createdAt === event.createdAt) {
        return state;
      }
      return {
        status: "draft",
        createdAt: event.createdAt,
        prompt: state?.prompt,
      };
    case "session.draft.discarded":
      return state?.status === "draft" ? undefined : state;
    case "session.prompt.drafted":
      if (state?.prompt && sameDraftPrompt(state.prompt, event.prompt)) return state;
      return state ? { ...state, prompt: event.prompt } : { status: "idle", prompt: event.prompt };
    case "session.creating":
      if (state?.status !== "draft") return state;
      return { ...state, status: "creating" };
    case "session.running":
      return state?.status === "running"
        ? state
        : { status: "running", ...(state?.prompt ? { prompt: state.prompt } : {}) };
    case "session.idle":
      if (!state || state.status === "draft") return state;
      if (state.status === "creating") return { ...state, status: "draft" };
      return idleSessionState(state.prompt);
    case "session.unread":
      return state?.status === "unread"
        ? state
        : { status: "unread", ...(state?.prompt ? { prompt: state.prompt } : {}) };
    case "session.read":
      return state?.status === "unread" ? idleSessionState(state.prompt) : state;
    case "session.upserted":
      if (state?.status === "draft" || state?.status === "creating") {
        return { status: "running", ...(state.prompt ? { prompt: state.prompt } : {}) };
      }
      return state;
    case "session.deleted":
      return undefined;
  }
}

function reduceSessionInWorkspace(
  workspace: WorkspaceState,
  sessionId: string,
  event: WorkspaceSessionEvent,
): WorkspaceState {
  const current = workspace.sessionStates[sessionId];
  const next = reduceWorkspaceSessionState(current, event);
  if (next === current) return workspace;

  if (!next) {
    if (!current) return workspace;
    const { [sessionId]: _, ...sessionStates } = workspace.sessionStates;
    return { ...workspace, sessionStates };
  }

  return {
    ...workspace,
    sessionStates: { ...workspace.sessionStates, [sessionId]: next },
  };
}

function idleSessionState(prompt?: DraftPrompt): WorkspaceSessionState | undefined {
  return prompt ? { status: "idle", prompt } : undefined;
}

function upsertInboxEntry(state: WorkspaceState, entry: InboxEntry): WorkspaceState {
  const index = state.inboxEntries.findIndex((existing) => existing.id === entry.id);
  if (index === -1) return { ...state, inboxEntries: [entry, ...state.inboxEntries] };
  if (areInboxEntriesEqual(state.inboxEntries[index], entry)) return state;

  const inboxEntries = [...state.inboxEntries];
  inboxEntries[index] = entry;
  return { ...state, inboxEntries };
}

function deleteInboxEntry(state: WorkspaceState, entryId: string): WorkspaceState {
  const inboxEntries = state.inboxEntries.filter((entry) => entry.id !== entryId);
  return inboxEntries.length === state.inboxEntries.length ? state : { ...state, inboxEntries };
}

function linkArtifactCommentSession(
  state: WorkspaceState,
  commentSession: ArtifactCommentSession,
): WorkspaceState {
  const existing = state.artifactCommentSessions.find(
    (current) => current.sessionId === commentSession.sessionId,
  );
  if (existing && areArtifactCommentSessionsEqual(existing, commentSession)) return state;

  const artifactCommentSessions = existing
    ? state.artifactCommentSessions.map((current) =>
        current.sessionId === commentSession.sessionId ? commentSession : current,
      )
    : [...state.artifactCommentSessions, commentSession];
  return { ...state, artifactCommentSessions };
}

function unlinkArtifactCommentSession(state: WorkspaceState, sessionId: string): WorkspaceState {
  const artifactCommentSessions = state.artifactCommentSessions.filter(
    (commentSession) => commentSession.sessionId !== sessionId,
  );
  return artifactCommentSessions.length === state.artifactCommentSessions.length
    ? state
    : { ...state, artifactCommentSessions };
}

function removeArtifactCommentSessionsForSession(
  state: WorkspaceState,
  sessionId: string,
): WorkspaceState {
  const artifactCommentSessions = state.artifactCommentSessions.filter(
    (commentSession) =>
      commentSession.sourceSessionId !== sessionId && commentSession.sessionId !== sessionId,
  );
  return artifactCommentSessions.length === state.artifactCommentSessions.length
    ? state
    : { ...state, artifactCommentSessions };
}

function registerArtifactKind(state: WorkspaceState, kind: CustomArtifactKind): WorkspaceState {
  const index = state.customArtifacts.findIndex((current) => current.name === kind.name);
  if (index === -1) return { ...state, customArtifacts: [...state.customArtifacts, kind] };
  if (areArtifactKindsEqual(state.customArtifacts[index], kind)) return state;

  const customArtifacts = [...state.customArtifacts];
  customArtifacts[index] = kind;
  return { ...state, customArtifacts };
}

function setHyperSessionMembership(
  state: WorkspaceState,
  sessionId: string,
  present: boolean,
): WorkspaceState {
  const hasSessionId = state.hyperSessionIds.includes(sessionId);
  if (present === hasSessionId) return state;

  return {
    ...state,
    hyperSessionIds: present
      ? [...state.hyperSessionIds, sessionId]
      : state.hyperSessionIds.filter((id) => id !== sessionId),
  };
}

function areArtifactKindsEqual(left: CustomArtifactKind, right: CustomArtifactKind): boolean {
  return (
    left.name === right.name &&
    left.icon === right.icon &&
    left.editable === right.editable &&
    left.html === right.html &&
    left.extensions.length === right.extensions.length &&
    left.extensions.every((extension, index) => extension === right.extensions[index])
  );
}

function areInboxEntriesEqual(left: InboxEntry, right: InboxEntry): boolean {
  return (
    left.id === right.id &&
    left.message === right.message &&
    left.artifact === right.artifact &&
    left.createdAt === right.createdAt
  );
}

function areArtifactCommentSessionsEqual(
  left: ArtifactCommentSession,
  right: ArtifactCommentSession,
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.sourceSessionId === right.sourceSessionId &&
    left.path === right.path &&
    left.threadId === right.threadId
  );
}

function sameDraftPrompt(left: DraftPrompt, right: DraftPrompt): boolean {
  return (
    left.text === right.text && left.origin === right.origin && left.updatedAt === right.updatedAt
  );
}
