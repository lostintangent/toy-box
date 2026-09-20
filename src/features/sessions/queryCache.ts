// React Query helpers for session-owned durable state.
//
// Workspace coordination and this durable session list occupy separate Query
// entries. Workspace lifecycle events update or invalidate only the session
// queries they identify; worktrees and managed-session ownership remain here.

import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceEvent } from "@workspace/model/events";
import type { Session, SessionUpdate, SessionsState } from "./model";
import { createEmptySessionsState, sessionQueries } from "./queries";
import { createInitialSessionState } from "./model/reducer";

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
      // Managed workflows can recreate this public ID while its pane stays
      // mounted. Cancel old history reads and retire the old transcript before
      // the replacement execution announces itself as running.
      void queryClient.cancelQueries({
        queryKey: sessionQueries.detail(event.sessionId).queryKey,
        exact: true,
      });
      queryClient.setQueryData(sessionQueries.detail(event.sessionId).queryKey, (previous) =>
        previous ? createInitialSessionState() : undefined,
      );
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

export function removeSessionFromState(queryClient: QueryClient, sessionId: string): void {
  updateSessionsState(queryClient, (state) => {
    if (
      !state.sessions.some((session) => session.id === sessionId) &&
      !Object.hasOwn(state.workerSessionParents, sessionId) &&
      !(sessionId in state.worktrees)
    ) {
      return state;
    }

    const { [sessionId]: _worktree, ...remainingWorktrees } = state.worktrees;
    const { [sessionId]: _workerParent, ...workerSessionParents } = state.workerSessionParents;
    return {
      ...state,
      sessions: state.sessions.filter((session) => session.id !== sessionId),
      workerSessionParents,
      worktrees: remainingWorktrees,
    };
  });
}

export function upsertSessionInState(queryClient: QueryClient, sessionUpdate: SessionUpdate): void {
  updateSessionsState(queryClient, (state) => {
    const sessionIndex = state.sessions.findIndex((session) => session.id === sessionUpdate.id);
    // Partial metadata updates may patch a projected Session, but only a
    // role-classified creation update has enough information to admit one.
    if (sessionIndex === -1 && !sessionUpdate.sessionType) return state;
    const existing = sessionIndex === -1 ? undefined : state.sessions[sessionIndex];
    const session = mergeSession(existing, sessionUpdate);

    const sessions = sessionIndex === -1 ? [session, ...state.sessions] : [...state.sessions];
    if (sessionIndex !== -1) sessions[sessionIndex] = session;

    const worktrees = sessionUpdate.worktree
      ? {
          ...state.worktrees,
          [sessionUpdate.id]: sessionUpdate.worktree,
        }
      : state.worktrees;
    const parentSessionId = sessionUpdate.parentSessionId ?? null;
    const workerSessionParents =
      sessionUpdate.sessionType === "worker" &&
      state.workerSessionParents[sessionUpdate.id] !== parentSessionId
        ? {
            ...state.workerSessionParents,
            [sessionUpdate.id]: parentSessionId,
          }
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

function mergeSession(existing: Session | undefined, update: SessionUpdate): Session {
  const updatedAt = parseEventDate(update.updatedAt, existing?.updatedAt ?? new Date());
  return {
    ...existing,
    id: update.id,
    createdAt: parseEventDate(update.createdAt, existing?.createdAt ?? updatedAt),
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
