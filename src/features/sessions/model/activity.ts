import type { WorkspaceEvent } from "@workspace/model/events";

/**
 * A session's shared activity, the same on the server and every client. Missing means idle.
 * Live activity remembers `since`, when its current run began.
 */
export type SessionActivity =
  | { status: "running" | "waiting" | "background"; since: number }
  | { status: "unread" };

/** A session's activity status, including idle, which has no stored activity. */
export type SessionActivityStatus = SessionActivity["status"] | "idle";

/** The activity of every session that is not idle, keyed by session ID. */
export type SessionsActivity = Record<string, SessionActivity>;

/** The canonical transition function shared by the server store and every client. It keeps
 *  identity when nothing changes, so callers can tell a real transition from a repeat. */
export function reduceSessionsActivity(
  activities: SessionsActivity,
  event: WorkspaceEvent,
): SessionsActivity {
  switch (event.type) {
    case "session.running":
    case "session.waiting":
    case "session.background": {
      const status =
        event.type === "session.running"
          ? "running"
          : event.type === "session.waiting"
            ? "waiting"
            : "background";
      const current = activities[event.sessionId];
      if (current?.status === status) return activities;
      // Moving between live states keeps the execution's start.
      const since = current && "since" in current ? current.since : event.at;
      return { ...activities, [event.sessionId]: { status, since } };
    }
    case "session.unread":
      return activities[event.sessionId]?.status === "unread"
        ? activities
        : { ...activities, [event.sessionId]: { status: "unread" } };
    case "session.read":
      return activities[event.sessionId]?.status === "unread"
        ? forget(activities, event.sessionId)
        : activities;
    case "session.idle":
    case "session.deleted":
      return forget(activities, event.sessionId);
    default:
      return activities;
  }
}

/** Whether a session is executing, including while it waits for input or runs in the background. */
export function isLiveActivity(status: SessionActivityStatus | undefined): boolean {
  return status === "running" || status === "waiting" || status === "background";
}

function forget(activities: SessionsActivity, sessionId: string): SessionsActivity {
  if (!(sessionId in activities)) return activities;
  const { [sessionId]: _, ...rest } = activities;
  return rest;
}
