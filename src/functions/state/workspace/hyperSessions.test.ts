import { describe, expect, onTestFinished, test } from "bun:test";
import { subscribeWorkspaceEvents } from "@/functions/runtime/broadcast";
import { addDraftSession, applyWorkspaceAction } from ".";
import { deleteSessionState } from "./sessions";
import { deleteHyperState, getHyperSessionIds } from "./hyperSessions";
import type { WorkspaceEvent } from "@/types";

function captureSessionEvents(sessionId: string): WorkspaceEvent[] {
  const events: WorkspaceEvent[] = [];
  const unsubscribe = subscribeWorkspaceEvents((event) => {
    if ("sessionId" in event && event.sessionId === sessionId) events.push(event);
  });
  onTestFinished(unsubscribe);
  return events;
}

describe("hyper session state", () => {
  test("projects a Hyper draft atomically and promotes it idempotently", () => {
    const sessionId = `hyper-${crypto.randomUUID()}`;
    onTestFinished(() => {
      deleteSessionState(sessionId);
      deleteHyperState(sessionId);
    });
    const events = captureSessionEvents(sessionId);

    addDraftSession({ sessionId, createdAt: 0 }, true);
    addDraftSession({ sessionId, createdAt: 0 }, true);
    expect(getHyperSessionIds()).toContain(sessionId);

    applyWorkspaceAction({ type: "session.hyper.promoted", sessionId });
    applyWorkspaceAction({ type: "session.hyper.promoted", sessionId });
    expect(getHyperSessionIds()).not.toContain(sessionId);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "session.drafted", sessionId, hyper: true });
    expect(events[1]).toEqual({ type: "session.hyper.promoted", sessionId });
  });
});
