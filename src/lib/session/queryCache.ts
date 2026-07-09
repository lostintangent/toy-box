// React Query helpers for durable session-list state.
//
// Workspace coordination lives in the Jotai workspace store. This file only
// mutates durable list-shaped data that still belongs in React Query: session
// metadata, worktrees, and child-session membership.

import type { QueryClient } from "@tanstack/react-query";
import { createEmptySessionsState, sessionQueries, type SessionsState } from "@/lib/queries";
import type { SessionMetadata, SessionMetadataUpdate, WorkspaceEvent } from "@/types";

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
      !state.childSessionIds.includes(sessionId) &&
      !(sessionId in state.worktrees)
    ) {
      return state;
    }

    const { [sessionId]: _, ...remainingWorktrees } = state.worktrees;
    return {
      ...state,
      sessions: state.sessions.filter((session) => session.sessionId !== sessionId),
      childSessionIds: state.childSessionIds.filter((id) => id !== sessionId),
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
    const childSessionIds =
      sessionUpdate.parentSessionId && !state.childSessionIds.includes(sessionUpdate.sessionId)
        ? [...state.childSessionIds, sessionUpdate.sessionId]
        : state.childSessionIds;

    return {
      ...state,
      sessions,
      worktrees,
      childSessionIds,
    };
  });
}

export async function cancelSessionsStateQuery(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: sessionQueries.stateKey() });
}

export async function invalidateSessionsStateQuery(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: sessionQueries.stateKey() });
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
