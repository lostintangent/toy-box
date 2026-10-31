import { useSuspenseQuery } from "@tanstack/react-query";
import type { SessionsActivity } from "./model/activity";
import { sessionQueries } from "./queries";

/** Subscribe to a projection of every session's activity, rerendering only when it changes. */
export function useSessionsActivity<T>(select: (activities: SessionsActivity) => T): T {
  return useSuspenseQuery({ ...sessionQueries.activity(), select }).data;
}

export function selectSessionActivity(activities: SessionsActivity, sessionId: string) {
  const activity = activities[sessionId];
  return {
    running: activity?.status === "running",
    waiting: activity?.status === "waiting",
    background: activity?.status === "background",
    unread: activity?.status === "unread",
    since: activity && "since" in activity ? activity.since : undefined,
  };
}

export function useSessionActivity(sessionId: string) {
  return useSessionsActivity((activities) => selectSessionActivity(activities, sessionId));
}
