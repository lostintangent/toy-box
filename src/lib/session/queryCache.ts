// React Query helpers for durable session-list state.
//
// Workspace coordination lives in the Jotai workspace store. This file only
// mutates durable list-shaped data that still belongs in React Query: session
// metadata, worktrees, and child-session membership.

import type { QueryClient } from "@tanstack/react-query";
import { createEmptySessionsState, sessionQueries, type SessionsState } from "@/lib/queries";
import type { SessionMetadata, SessionMetadataUpdate, WorkspaceEvent } from "@/types";

function addSessionId(list: string[], sessionId: string): string[] {
  if (list.includes(sessionId)) return list;
  return [...list, sessionId];
}

function removeSessionId(list: string[], sessionId: string): string[] {
  if (!list.includes(sessionId)) return list;
  return list.filter((id) => id !== sessionId);
}

function parseEventDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function applySessionUpsert(
  existing: SessionMetadata | undefined,
  update: SessionMetadataUpdate,
): SessionMetadata {
  const now = new Date();
  const fallbackModified = existing?.modifiedTime ?? now;
  const modifiedTime = parseEventDate(update.modifiedTime, fallbackModified);
  const fallbackStart = existing?.startTime ?? modifiedTime;
  const startTime = parseEventDate(update.startTime, fallbackStart);

  return {
    sessionId: update.sessionId,
    startTime,
    modifiedTime,
    summary: update.summary ?? existing?.summary ?? "",
    isRemote: update.isRemote ?? existing?.isRemote ?? false,
    context: update.context ?? existing?.context,
  };
}

export function getSessionsStateSnapshot(queryClient: QueryClient): SessionsState | undefined {
  return queryClient.getQueryData<SessionsState>(sessionQueries.stateKey());
}

export function getSessionsState(queryClient: QueryClient): SessionsState {
  return getSessionsStateSnapshot(queryClient) ?? createEmptySessionsState();
}

export function replaceSessionsState(queryClient: QueryClient, state: SessionsState): void {
  queryClient.setQueryData<SessionsState>(sessionQueries.stateKey(), state);
}

function updateSessionsState(
  queryClient: QueryClient,
  updater: (state: SessionsState) => SessionsState,
): void {
  queryClient.setQueryData<SessionsState>(sessionQueries.stateKey(), (old) =>
    updater(old ?? createEmptySessionsState()),
  );
}

export function prependSessionIfMissing(queryClient: QueryClient, session: SessionMetadata): void {
  updateSessionsState(queryClient, (old) => {
    if (old.sessions.some((item) => item.sessionId === session.sessionId)) {
      return old;
    }

    return {
      ...old,
      sessions: [session, ...old.sessions],
    };
  });
}

export function removeSessionFromState(queryClient: QueryClient, sessionId: string): void {
  updateSessionsState(queryClient, (old) => {
    const { [sessionId]: _, ...remainingMetadata } = old.worktrees;
    return {
      ...old,
      sessions: old.sessions.filter((session) => session.sessionId !== sessionId),
      childSessionIds: removeSessionId(old.childSessionIds, sessionId),
      worktrees: remainingMetadata,
    };
  });
}

export function upsertSessionInState(
  queryClient: QueryClient,
  sessionUpdate: SessionMetadataUpdate,
): void {
  updateSessionsState(queryClient, (old) => {
    const index = old.sessions.findIndex(
      (session) => session.sessionId === sessionUpdate.sessionId,
    );
    const existing = index === -1 ? undefined : old.sessions[index];
    const upserted = applySessionUpsert(existing, sessionUpdate);

    const sessions = index === -1 ? [upserted, ...old.sessions] : [...old.sessions];
    if (index !== -1) sessions[index] = upserted;

    const worktrees = sessionUpdate.worktree
      ? { ...old.worktrees, [sessionUpdate.sessionId]: sessionUpdate.worktree }
      : old.worktrees;
    const childSessionIds = sessionUpdate.parentSessionId
      ? addSessionId(old.childSessionIds, sessionUpdate.sessionId)
      : old.childSessionIds;

    return {
      ...old,
      sessions,
      worktrees,
      childSessionIds,
    };
  });
}

export function syncSessionQueriesFromWorkspaceEvent(
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

export async function cancelSessionsState(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: sessionQueries.stateKey() });
}

export async function invalidateSessionsState(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: sessionQueries.stateKey() });
}
