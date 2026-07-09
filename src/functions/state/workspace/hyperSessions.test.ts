import { describe, expect, onTestFinished, test } from "bun:test";
import { subscribeWorkspaceEvents } from "@/functions/runtime/broadcast";
import { applyWorkspaceAction } from ".";
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

describe("hyper session actions", () => {
  test("creates draft membership atomically and promotes it idempotently", () => {
    const sessionId = `hyper-${crypto.randomUUID()}`;
    onTestFinished(() => {
      deleteSessionState(sessionId);
      deleteHyperState(sessionId);
    });
    const events = captureSessionEvents(sessionId);

    applyWorkspaceAction({
      type: "session.draft.created",
      sessionId,
      createdAt: 0,
      hyper: true,
    });
    applyWorkspaceAction({
      type: "session.draft.created",
      sessionId,
      createdAt: 0,
      hyper: true,
    });
    expect(getHyperSessionIds()).toContain(sessionId);

    applyWorkspaceAction({ type: "session.hyper.promoted", sessionId });
    applyWorkspaceAction({ type: "session.hyper.promoted", sessionId });
    expect(getHyperSessionIds()).not.toContain(sessionId);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "session.draft.created", sessionId, hyper: true });
    expect(events[1]).toEqual({ type: "session.hyper.promoted", sessionId });
  });

  test("out-of-band removal makes promotion a silent no-op", () => {
    const sessionId = `hyper-delete-${crypto.randomUUID()}`;
    onTestFinished(() => {
      deleteSessionState(sessionId);
      deleteHyperState(sessionId);
    });
    const events = captureSessionEvents(sessionId);

    applyWorkspaceAction({
      type: "session.draft.created",
      sessionId,
      createdAt: 0,
      hyper: true,
    });
    expect(deleteHyperState(sessionId)).toBe(true);
    applyWorkspaceAction({ type: "session.hyper.promoted", sessionId }); // nothing to promote

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "session.draft.created", sessionId, hyper: true });
  });
});
