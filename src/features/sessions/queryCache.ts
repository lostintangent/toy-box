// React Query helpers for session-owned durable state.
//
// Workspace coordination and this durable session list occupy separate Query
// entries. Workspace lifecycle events update or invalidate only the session
// queries they identify; worktrees and worker ownership remain here.

import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceEvent } from "@workspace/model/events";
import type { SessionMetadata, SessionMetadataUpdate, SessionsState } from "./model";
import { createEmptySessionsState, sessionQueries } from "./queries";

export function applyWorkspaceEventToSessionQueries(
  queryClient: QueryClient,
  event: WorkspaceEvent,
): void {
  switch (event.type) {
    case "session.upserted":
      upsertSessionInState(queryClient, event.session);
      return;
    case "session.deleted":
      removeSessionFromState(queryClient, event.sessionId);
      return;
    case "session.touched":
      void queryClient.invalidateQueries({
        queryKey: sessionQueries.stateKey(),
        exact: true,
      });
      void queryClient.invalidateQueries({
        queryKey: sessionQueries.detail(event.sessionId).queryKey,
        exact: true,
      });
      return;
  }
}

export function snapshotSessionsState(queryClient: QueryClient): SessionsState | undefined {
  return queryClient.getQueryData<SessionsState>(sessionQueries.stateKey());
}

export function restoreSessionsState(queryClient: QueryClient, state: SessionsState): void {
  queryClient.setQueryData<SessionsState>(sessionQueries.stateKey(), state);
}

export function addSessionIfMissing(queryClient: QueryClient, session: SessionMetadata): void {
  updateSessionsState(queryClient, (state) => {
    if (state.sessions.some((existing) => existing.sessionId === session.sessionId)) {
      return state;
    }

    return {
      ...state,
      sessions: [session, ...state.sessions],
    };
  });
}

export function removeSessionFromState(queryClient: QueryClient, sessionId: string): void {
  updateSessionsState(queryClient, (state) => {
    if (
      !state.sessions.some((session) => session.sessionId === sessionId) &&
      !Object.hasOwn(state.workerSessionParents, sessionId) &&
      !(sessionId in state.worktrees)
    ) {
      return state;
    }

    const { [sessionId]: _worktree, ...remainingWorktrees } = state.worktrees;
    const { [sessionId]: _workerParent, ...workerSessionParents } = state.workerSessionParents;
    return {
      ...state,
      sessions: state.sessions.filter((session) => session.sessionId !== sessionId),
      workerSessionParents,
      worktrees: remainingWorktrees,
    };
  });
}

export function upsertSessionInState(
  queryClient: QueryClient,
  sessionUpdate: SessionMetadataUpdate,
): void {
  updateSessionsState(queryClient, (state) => {
    const sessionIndex = state.sessions.findIndex(
      (session) => session.sessionId === sessionUpdate.sessionId,
    );
    const existing = sessionIndex === -1 ? undefined : state.sessions[sessionIndex];
    const session = mergeSessionMetadata(existing, sessionUpdate);

    const sessions = sessionIndex === -1 ? [session, ...state.sessions] : [...state.sessions];
    if (sessionIndex !== -1) sessions[sessionIndex] = session;

    const worktrees = sessionUpdate.worktree
      ? { ...state.worktrees, [sessionUpdate.sessionId]: sessionUpdate.worktree }
      : state.worktrees;
    const parentSessionId = sessionUpdate.parentSessionId ?? null;
    const workerSessionParents =
      sessionUpdate.sessionType === "worker" &&
      state.workerSessionParents[sessionUpdate.sessionId] !== parentSessionId
        ? { ...state.workerSessionParents, [sessionUpdate.sessionId]: parentSessionId }
        : state.workerSessionParents;

    return {
      ...state,
      sessions,
      worktrees,
      workerSessionParents,
    };
  });
}

export async function cancelSessionsStateQuery(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: sessionQueries.stateKey() });
}

export async function invalidateSessionsStateQuery(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries(
    { queryKey: sessionQueries.stateKey() },
    { throwOnError: true },
  );
}

function updateSessionsState(
  queryClient: QueryClient,
  updater: (state: SessionsState) => SessionsState,
): void {
  queryClient.setQueryData<SessionsState>(sessionQueries.stateKey(), (old) =>
    updater(old ?? createEmptySessionsState()),
  );
}

function mergeSessionMetadata(
  existing: SessionMetadata | undefined,
  update: SessionMetadataUpdate,
): SessionMetadata {
  const now = new Date();
  const fallbackModifiedTime = existing?.modifiedTime ?? now;
  const modifiedTime = parseEventDate(update.modifiedTime, fallbackModifiedTime);
  const fallbackStartTime = existing?.startTime ?? modifiedTime;
  const startTime = parseEventDate(update.startTime, fallbackStartTime);

  return {
    sessionId: update.sessionId,
    startTime,
    modifiedTime,
    summary: update.summary ?? existing?.summary ?? "",
    isRemote: update.isRemote ?? existing?.isRemote ?? false,
    context: update.context ?? existing?.context,
  };
}

function parseEventDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}
