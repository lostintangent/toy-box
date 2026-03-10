// React Query cache helpers for the session list.
//
// Manages sidebar-level metadata (upsert, delete, streaming/unread
// flags) by mutating the shared SessionsState query data. This is the
// list-level counterpart to the reducer's per-session detail state.

import type { QueryClient } from "@tanstack/react-query";
import { createEmptySessionsState, sessionQueries, type SessionsState } from "@/lib/queries";
import type { SessionMetadata, SessionMetadataUpdate, SessionsUpdateEvent } from "@/types";

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

function resolveUpsertedSummary(
  existingSummary: string | undefined,
  update: Pick<SessionMetadataUpdate, "summary" | "replaceSummary">,
): string {
  if (update.summary === undefined) {
    return existingSummary ?? "";
  }

  const shouldReplaceExisting = update.replaceSummary || !existingSummary;
  return shouldReplaceExisting ? update.summary : existingSummary;
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
    summary: resolveUpsertedSummary(existing?.summary, update),
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

export function setSessionStreaming(
  queryClient: QueryClient,
  sessionId: string,
  isStreaming: boolean,
): void {
  updateSessionIdMembership(queryClient, "streamingSessionIds", sessionId, isStreaming);
}

export function setSessionUnread(
  queryClient: QueryClient,
  sessionId: string,
  isUnread: boolean,
): void {
  updateSessionIdMembership(queryClient, "unreadSessionIds", sessionId, isUnread);
}

function updateSessionIdMembership(
  queryClient: QueryClient,
  key: "streamingSessionIds" | "unreadSessionIds",
  sessionId: string,
  present: boolean,
): void {
  updateSessionsState(queryClient, (old) => ({
    ...old,
    [key]: present ? addSessionId(old[key], sessionId) : removeSessionId(old[key], sessionId),
  }));
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
      streamingSessionIds: old.streamingSessionIds.filter((id) => id !== sessionId),
      unreadSessionIds: old.unreadSessionIds.filter((id) => id !== sessionId),
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

    // Merge worktree data if present on the upsert event
    const worktrees = sessionUpdate.worktree
      ? { ...old.worktrees, [sessionUpdate.sessionId]: sessionUpdate.worktree }
      : old.worktrees;

    return { ...old, sessions, worktrees };
  });
}

export function applySessionsUpdateEvent(
  queryClient: QueryClient,
  event: SessionsUpdateEvent,
): void {
  switch (event.type) {
    case "session.upserted":
      upsertSessionInState(queryClient, event.session);
      return;
    case "session.deleted":
      removeSessionFromState(queryClient, event.sessionId);
      return;
    case "session.running":
      setSessionStreaming(queryClient, event.sessionId, true);
      return;
    case "session.idle":
      setSessionStreaming(queryClient, event.sessionId, false);
      return;
    case "session.unread":
      setSessionUnread(queryClient, event.sessionId, true);
      return;
    case "session.read":
      setSessionUnread(queryClient, event.sessionId, false);
      return;
  }
}

export async function cancelSessionsState(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries({ queryKey: sessionQueries.stateKey() });
}

export async function invalidateSessionsState(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: sessionQueries.stateKey() });
}
