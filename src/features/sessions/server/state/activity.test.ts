import { describe, expect, onTestFinished, test } from "bun:test";
import type { WorkspaceEvent } from "@workspace/model/events";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import {
  deleteSessionActivity,
  getSessionActivity,
  getSessionsActivity,
  markSessionRead,
  setSessionActivity,
} from "./activity";

describe("session activity store", () => {
  test("broadcasts only real transitions", () => {
    const sessionId = createSessionId();
    const events = capture(sessionId);

    setSessionActivity(sessionId, "running");
    setSessionActivity(sessionId, "running");
    setSessionActivity(sessionId, "waiting");
    setSessionActivity(sessionId, "waiting");
    setSessionActivity(sessionId, "background");
    setSessionActivity(sessionId, "background");
    setSessionActivity(sessionId, "unread");
    setSessionActivity(sessionId, "unread");
    markSessionRead(sessionId);
    markSessionRead(sessionId);

    expect(events.map((event) => event.type)).toEqual([
      "session.running",
      "session.waiting",
      "session.background",
      "session.unread",
      "session.read",
    ]);
    expect(getSessionActivity(sessionId)).toBeUndefined();
  });

  test("a deleted session has no activity and broadcasts nothing", () => {
    const sessionId = createSessionId();
    setSessionActivity(sessionId, "unread");
    const events = capture(sessionId);

    deleteSessionActivity(sessionId);

    expect(getSessionActivity(sessionId)).toBeUndefined();
    expect(sessionId in getSessionsActivity()).toBe(false);
    expect(events).toEqual([]);
  });
});

function createSessionId(): string {
  const sessionId = `session-activity-${crypto.randomUUID()}`;
  onTestFinished(() => deleteSessionActivity(sessionId));
  return sessionId;
}

function capture(sessionId: string): WorkspaceEvent[] {
  const events: WorkspaceEvent[] = [];
  const unsubscribe = subscribeWorkspaceEvents((event) => {
    if ("sessionId" in event && event.sessionId === sessionId) events.push(event);
  });
  onTestFinished(unsubscribe);
  return events;
}
