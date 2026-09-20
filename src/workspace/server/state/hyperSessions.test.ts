import { describe, expect, onTestFinished, test } from "bun:test";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { applyWorkspaceAction } from ".";
import { deleteSessionState } from "./sessions";
import { addHyperSession, deleteHyperState, getHyperSessionIds } from "./hyperSessions";
import type { WorkspaceEvent } from "@workspace/model/events";

function captureSessionEvents(sessionId: string): WorkspaceEvent[] {
  const events: WorkspaceEvent[] = [];
  const unsubscribe = subscribeWorkspaceEvents((event) => {
    if ("sessionId" in event && event.sessionId === sessionId) events.push(event);
  });
  onTestFinished(unsubscribe);
  return events;
}

describe("hyper session state", () => {
  test("promotes Hyper membership idempotently", () => {
    const sessionId = `hyper-${crypto.randomUUID()}`;
    onTestFinished(() => {
      deleteSessionState(sessionId);
      deleteHyperState(sessionId);
    });
    const events = captureSessionEvents(sessionId);

    addHyperSession(sessionId);
    addHyperSession(sessionId);
    expect(getHyperSessionIds()).toContain(sessionId);

    applyWorkspaceAction({ type: "session.hyper.promoted", sessionId });
    applyWorkspaceAction({ type: "session.hyper.promoted", sessionId });
    expect(getHyperSessionIds()).not.toContain(sessionId);

    expect(events).toEqual([{ type: "session.hyper.promoted", sessionId }]);
  });
});
