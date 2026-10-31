// Process-local activity for every session: whether it is running, waiting,
// in the background, or finished with unread results. Active execution doesn't
// survive a restart, so neither does its activity.

import type { WorkspaceEvent } from "@workspace/model/events";
import { broadcast } from "@workspace/server/events";
import { getProcessValue } from "@/shared/server/processState";
import {
  reduceSessionsActivity,
  type SessionActivity,
  type SessionActivityStatus,
  type SessionsActivity,
} from "../../model/activity";

const store = getProcessValue("session-activity", () => ({ activities: {} as SessionsActivity }));

export function getSessionsActivity(): SessionsActivity {
  return store.activities;
}

export function getSessionActivity(sessionId: string): SessionActivity | undefined {
  return store.activities[sessionId];
}

export function setSessionActivity(sessionId: string, status: SessionActivityStatus): void {
  commit(
    status === "running" || status === "waiting" || status === "background"
      ? { type: `session.${status}`, sessionId, at: Date.now() }
      : { type: `session.${status}`, sessionId },
  );
}

export function markSessionRead(sessionId: string): void {
  commit({ type: "session.read", sessionId });
}

/** Forget a deleted session's activity. The registry's `session.deleted` broadcast tells clients. */
export function deleteSessionActivity(sessionId: string): void {
  store.activities = reduceSessionsActivity(store.activities, {
    type: "session.deleted",
    sessionId,
  });
}

/** Reduce a transition in, then broadcast it only if the reducer accepted it. */
function commit(event: WorkspaceEvent): void {
  const next = reduceSessionsActivity(store.activities, event);
  if (next === store.activities) return;

  store.activities = next;
  broadcast(event);
}
