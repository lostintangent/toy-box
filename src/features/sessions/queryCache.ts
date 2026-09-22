// React Query helpers for session-owned durable state.
//
// Workspace coordination and this durable session list occupy separate Query
// entries. Workspace lifecycle events update or invalidate only the session
// queries they identify; worktrees and managed-session ownership remain here.

import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceEvent } from "@workspace/model/events";
import type { Session, SessionLaunch, SessionType, SessionUpdate, SessionsState } from "./model";
import { createEmptySessionsState, sessionQueries } from "./queries";
import { createInitialSessionState } from "./model/reducer";

/** Replace the cached session before requesting its recreation on the server. */
export async function recreateSessionInCache(
  queryClient: QueryClient,
  sessionId: string,
  message: SessionLaunch["message"] & { clientId: string },
  options: {
    title?: string;
    sessionType?: SessionType;
    parentSessionId?: string;
  } = {},
): Promise<void> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: sessionQueries.stateKey() }),
    queryClient.cancelQueries({ queryKey: sessionQueries.detail(sessionId).queryKey }),
  ]);

  const timestamp = new Date().toISOString();
  updateSessionsState(queryClient, (state) =>
    upsertSession(removeSession(state, sessionId), {
      ...options,
      id: sessionId,
      sessionType: options.sessionType ?? "standard",
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  queryClient.setQueryData(
    sessionQueries.detail(sessionId).queryKey,
    createInitialSessionState({
      model: message.model,
      status: "thinking",
      messages: [
        {
          role: "user",
          clientId: message.clientId,
          content: message.content,
          attachments: message.attachments,
          timestamp,
        },
      ],
    }),
  );
}

export function applyWorkspaceEventToSessionQueries(
  queryClient: QueryClient,
  event: WorkspaceEvent,
): void {
  switch (event.type) {
    case "session.upserted": {
      const current = queryClient
        .getQueryData<SessionsState>(sessionQueries.stateKey())
        ?.sessions.find((session) => session.id === event.session.id);
      // Acknowledging our optimistic draft retains its starting message.
      if (current?.provider && isSessionReplacement(current, event.session)) {
        retireSessionDetail(queryClient, event.session.id);
      }
      upsertSessionInState(queryClient, event.session);
      return;
    }
    case "session.deleted":
      removeSessionFromState(queryClient, event.sessionId);
      retireSessionDetail(queryClient, event.sessionId);
      return;
    case "session.touched":
      void invalidateSessionQueries(queryClient, event.sessionId);
      return;
    case "session.running":
    case "session.waiting":
    case "session.unread":
    case "session.prompt.drafted":
      // Activity can bring an older session back into the browsing window.
      if (!snapshotSessionsState(queryClient)?.sessions.some(({ id }) => id === event.sessionId)) {
        void queryClient.invalidateQueries({ queryKey: sessionQueries.stateKey(), exact: true });
      }
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
  updateSessionsState(queryClient, (state) => removeSession(state, sessionId));
}

export function upsertSessionInState(queryClient: QueryClient, sessionUpdate: SessionUpdate): void {
  updateSessionsState(queryClient, (state) => upsertSession(state, sessionUpdate));
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

/** Reconcile a session's catalog entry and transcript after a lifecycle change. */
export async function invalidateSessionQueries(
  queryClient: QueryClient,
  sessionId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: sessionQueries.stateKey(), exact: true }),
    queryClient.invalidateQueries({
      queryKey: sessionQueries.detail(sessionId).queryKey,
      exact: true,
    }),
  ]);
}

function retireSessionDetail(queryClient: QueryClient, sessionId: string): void {
  void queryClient.cancelQueries({
    queryKey: sessionQueries.detail(sessionId).queryKey,
    exact: true,
  });
  queryClient.setQueryData(sessionQueries.detail(sessionId).queryKey, (previous) =>
    previous ? createInitialSessionState() : undefined,
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

function removeSession(state: SessionsState, sessionId: string): SessionsState {
  if (
    !state.sessions.some((session) => session.id === sessionId) &&
    !Object.hasOwn(state.workerSessionParents, sessionId) &&
    !(sessionId in state.worktrees)
  ) {
    return state;
  }

  const { [sessionId]: _worktree, ...worktrees } = state.worktrees;
  const { [sessionId]: _parent, ...workerSessionParents } = state.workerSessionParents;
  return {
    ...state,
    sessions: state.sessions.filter((session) => session.id !== sessionId),
    workerSessionParents,
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
  const parentSessionId = update.parentSessionId ?? null;
  const workerSessionParents =
    update.sessionType === "worker" && state.workerSessionParents[update.id] !== parentSessionId
      ? { ...state.workerSessionParents, [update.id]: parentSessionId }
      : state.workerSessionParents;
  return { ...state, sessions, worktrees, workerSessionParents };
}

function isSessionReplacement(session: Session | undefined, update: SessionUpdate): boolean {
  return (
    session !== undefined &&
    parseEventDate(update.createdAt, session.createdAt).getTime() !== session.createdAt.getTime()
  );
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
