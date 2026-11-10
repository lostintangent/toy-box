import {
  experimental_streamedQuery as streamedQuery,
  queryOptions,
  replaceEqualDeep,
  skipToken,
} from "@tanstack/react-query";
import { reducedQuery } from "@/shared/query";
import type { SessionState, SessionsState } from "./model";
import { reduceSessionsActivity } from "./model/activity";
import { applySessionEvent, createInitialSessionState } from "./model/reducer";
import { reduceSessionsState } from "./model/catalog";
import { joinPreviousMessages } from "./model/transcriptPages";
import {
  getSessionsActivity,
  getSessionsState,
  listSkills,
  querySession,
  querySessionMessages,
  resolveSessionContext,
} from "./server/functions";
import { streamSession, type SessionObservation } from "./stream";

export const sessionQueries = {
  all: () => ["sessions"] as const,

  // Durable sidebar/list snapshot, reconciled with live and optimistic events. Live
  // activity has its own query below, and composer drafts live in the workspace state query.
  state: reducedQuery({
    queryKey: ["sessions", "state"],
    fetch: ({ signal }) => getSessionsState({ signal }),
    reduce: reduceSessionsState,
  }),

  // Every session's shared activity. Live events update it, and the shared SSE
  // connection refreshes it after missed updates or reconnects.
  activity: reducedQuery({
    queryKey: ["sessions", "activity"],
    fetch: () => getSessionsActivity(),
    reduce: reduceSessionsActivity,
  }),

  context: (directory?: string) =>
    queryOptions({
      queryKey: [...sessionQueries.all(), "context", directory ?? null] as const,
      queryFn: directory ? () => resolveSessionContext({ data: { directory } }) : skipToken,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    }),

  details: () => [...sessionQueries.all(), "detail"] as const,

  // A session's reduced state, observed while an enabled observer watches it. Nothing
  // awaits its fetch, which lasts until the last watcher leaves.
  detail: (sessionId: string) =>
    queryOptions({
      queryKey: [...sessionQueries.details(), sessionId] as const,
      queryFn: streamedQuery<SessionObservation, SessionState>({
        initialValue: createInitialSessionState(),
        refetchMode: "append",
        streamFn: (context) =>
          streamSession(context, {
            sessionId,
            activityKey: sessionQueries.activity.queryKey,
            readSnapshot: (signal) => querySession({ data: { sessionId }, signal }),
          }),
        reducer: (state, observation) =>
          observation.type === "snapshot"
            ? adoptSessionSnapshot(state, observation.state)
            : observation.events.reduce(applySessionEvent, state),
      }),
      staleTime: 0, // Every watch reopens with a snapshot of the latest messages.
      refetchOnWindowFocus: "always",
      refetchOnReconnect: "always",
      retry: false, // Don't retry on "session not found" errors
      // Every write keeps the previous pages already loaded.
      structuralSharing: (previous: unknown, next: unknown) =>
        replaceEqualDeep(
          previous,
          previous ? joinPreviousMessages(previous as SessionState, next as SessionState) : next,
        ),
    }),

  messagesBefore: (sessionId: string, before: number) =>
    queryOptions({
      queryKey: [...sessionQueries.details(), sessionId, "before", before] as const,
      queryFn: () => querySessionMessages({ data: { sessionId, before } }),
      staleTime: 0,
      gcTime: 0,
    }),
};

/** A snapshot replaces a session's state but keeps its locally picked model when
 *  older history has none. */
export function adoptSessionSnapshot(
  current: SessionState | undefined,
  snapshot: SessionState,
): SessionState {
  return snapshot.model || !current?.model ? snapshot : { ...snapshot, model: current.model };
}

export function createEmptySessionsState(): SessionsState {
  return {
    sessions: [],
    worktrees: {},
    ownership: {},
  };
}

/** Exclude Worker backing Sessions while preserving their metadata for owning surfaces. */
export function selectNonWorkerSessions(state: SessionsState): SessionsState["sessions"] {
  return state.sessions.filter(({ id }) => state.ownership[id]?.type !== "worker");
}

/** The sidebar's root population, before its local search and display limit. */
export function selectTopLevelSessions(
  state: Pick<SessionsState, "sessions" | "ownership">,
  hyperSessionId: string | null,
): SessionsState["sessions"] {
  return state.sessions.filter(({ id }) => !state.ownership[id] && id !== hyperSessionId);
}

/** Index child sessions by their durable parent, including retained and nested workers. */
export function selectSessionChildren(
  state: SessionsState,
): Record<string, SessionsState["sessions"]> {
  const childrenByParent: Record<string, SessionsState["sessions"]> = {};
  for (const session of state.sessions) {
    const owner = state.ownership[session.id];
    if (owner?.type !== "worker" || !owner.parentSessionId) continue;
    (childrenByParent[owner.parentSessionId] ??= []).push(session);
  }
  return childrenByParent;
}

export function selectAutomationSessionIds(state: SessionsState): string[] {
  return Object.keys(state.ownership).filter((id) => state.ownership[id]?.type === "automation");
}

/** Skills by directory and provider; no directory means host-level discovery. */
export const skillQueries = {
  list: (cwd?: string, provider?: string) =>
    queryOptions({
      queryKey: ["skills", cwd ?? null, provider ?? null] as const,
      queryFn: () => listSkills({ data: { cwd, provider } }),
      staleTime: Infinity,
    }),
};
