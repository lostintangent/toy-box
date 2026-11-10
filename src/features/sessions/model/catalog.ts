import type { WorkspaceEvent } from "@workspace/model/events";
import type { Session, SessionOwnership, SessionsState, SessionUpdate } from ".";

/** The catalog's transition function for every client. Sessions enter only through a
 *  role-classified upsert, and managed ownership can precede and outlive its backing session. */
export function reduceSessionsState(state: SessionsState, event: WorkspaceEvent): SessionsState {
  switch (event.type) {
    case "session.upserted":
      return upsertSession(state, event.session);
    case "session.deleted":
      return removeSession(state, event.sessionId);
    case "automation.upserted":
      return setOwnership(state, event.automation.id, { type: "automation" });
    case "automation.deleted":
      return removeSession(setOwnership(state, event.automationId, undefined), event.automationId);
    default:
      return state;
  }
}

/** Whether an upsert starts a new session under an existing ID, such as an Automation's next run. */
export function isSessionReplacement(session: Session | undefined, update: SessionUpdate): boolean {
  return (
    session !== undefined &&
    parseEventDate(update.createdAt, session.createdAt).getTime() !== session.createdAt.getTime()
  );
}

function removeSession(state: SessionsState, sessionId: string): SessionsState {
  const removesOwnership = state.ownership[sessionId]?.type === "worker";
  if (
    !state.sessions.some((session) => session.id === sessionId) &&
    !removesOwnership &&
    !(sessionId in state.worktrees)
  ) {
    return state;
  }

  const { [sessionId]: _worktree, ...worktrees } = state.worktrees;
  return {
    ...(removesOwnership ? setOwnership(state, sessionId, undefined) : state),
    sessions: state.sessions.filter((session) => session.id !== sessionId),
    worktrees,
  };
}

function upsertSession(state: SessionsState, update: SessionUpdate): SessionsState {
  let existing = state.sessions.find((session) => session.id === update.id);
  // Only a role-classified creation can admit a missing session.
  if (!existing && !update.sessionType) return state;
  if (isSessionReplacement(existing, update)) {
    state = removeSession(state, update.id);
    existing = undefined;
  }
  const session = mergeSession(existing, update);
  const sessions = existing
    ? state.sessions.map((current) => (current.id === update.id ? session : current))
    : [session, ...state.sessions];

  const worktrees = update.worktree
    ? { ...state.worktrees, [update.id]: update.worktree }
    : state.worktrees;
  const owner = state.ownership[update.id];
  switch (update.sessionType) {
    case "worker":
      state = setOwnership(state, update.id, {
        type: "worker",
        parentSessionId:
          update.parentSessionId ?? (owner?.type === "worker" ? owner.parentSessionId : null),
      });
      break;
    case "automation":
      state = setOwnership(state, update.id, { type: update.sessionType });
      break;
  }
  return { ...state, sessions, worktrees };
}

function setOwnership(
  state: SessionsState,
  sessionId: string,
  owner: SessionOwnership | undefined,
): SessionsState {
  const previous = state.ownership[sessionId];
  if (
    previous?.type === owner?.type &&
    (previous?.type !== "worker" ||
      (owner?.type === "worker" && previous.parentSessionId === owner.parentSessionId))
  ) {
    return state;
  }
  const ownership = { ...state.ownership };
  if (owner) ownership[sessionId] = owner;
  else delete ownership[sessionId];
  return { ...state, ownership };
}

function mergeSession(existing: Session | undefined, update: SessionUpdate): Session {
  const updatedAt = parseEventDate(update.updatedAt, existing?.updatedAt ?? new Date());
  const createdAt = parseEventDate(update.createdAt, existing?.createdAt ?? updatedAt);
  return {
    ...existing,
    id: update.id,
    createdAt,
    updatedAt,
    title: update.title ?? existing?.title,
    provider: update.provider ?? existing?.provider,
    context: update.context ? { ...existing?.context, ...update.context } : existing?.context,
    artifactPath: update.artifactPath ?? existing?.artifactPath,
  };
}

function parseEventDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}
