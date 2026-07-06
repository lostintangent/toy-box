import { describe, expect, onTestFinished, test } from "bun:test";
import { subscribeWorkspaceEvents } from "@/functions/runtime/broadcast";
import { deleteHyperState, getHyperSessionIds, markSessionHyper, markSessionPromoted } from ".";
import type { WorkspaceEvent } from "@/types";

function captureSessionEvents(sessionId: string): WorkspaceEvent[] {
  const events: WorkspaceEvent[] = [];
  const unsubscribe = subscribeWorkspaceEvents((event) => {
    if ("sessionId" in event && event.sessionId === sessionId) {
      events.push(event);
    }
  });
  onTestFinished(unsubscribe);
  return events;
}

describe("hyper session state", () => {
  test("marks and promotes membership idempotently", () => {
    const sessionId = `hyper-${crypto.randomUUID()}`;
    onTestFinished(() => {
      deleteHyperState(sessionId);
    });
    const events = captureSessionEvents(sessionId);

    markSessionHyper(sessionId);
    markSessionHyper(sessionId);
    expect(getHyperSessionIds()).toContain(sessionId);

    markSessionPromoted(sessionId);
    markSessionPromoted(sessionId);
    expect(getHyperSessionIds()).not.toContain(sessionId);

    expect(events).toEqual([
      { type: "session.hyper.created", sessionId },
      { type: "session.hyper.promoted", sessionId },
    ]);
  });

  test("silent deletion does not emit promotion", () => {
    const sessionId = `hyper-delete-${crypto.randomUUID()}`;
    onTestFinished(() => {
      deleteHyperState(sessionId);
    });
    const events = captureSessionEvents(sessionId);

    markSessionHyper(sessionId);
    expect(deleteHyperState(sessionId)).toBe(true);

    expect(events).toEqual([{ type: "session.hyper.created", sessionId }]);
  });
});
