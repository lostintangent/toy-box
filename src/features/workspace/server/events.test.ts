import { expect, onTestFinished, spyOn, test } from "bun:test";
import type { WorkspaceEvent } from "@workspace/model/events";
import { broadcast, getWorkspaceRevision, subscribeWorkspaceEvents } from "./events";

test("the workspace revision stays stable until a broadcast, even with no clients", () => {
  const before = getWorkspaceRevision();
  expect(getWorkspaceRevision()).toBe(before);

  broadcast({ type: "session.running", sessionId: crypto.randomUUID() });

  const after = getWorkspaceRevision();
  expect(after).not.toBe(before);
  expect(getWorkspaceRevision()).toBe(after);
});

test("subscribers observe the new revision while receiving its update", () => {
  const before = getWorkspaceRevision();
  const revisions: string[] = [];
  const unsubscribe = subscribeWorkspaceEvents(() => revisions.push(getWorkspaceRevision()));
  onTestFinished(unsubscribe);

  broadcast({ type: "session.running", sessionId: crypto.randomUUID() });

  expect(revisions).toEqual([getWorkspaceRevision()]);
  expect(revisions[0]).not.toBe(before);
});

test("one failed workspace listener does not interrupt the remaining clients", () => {
  const consoleError = spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => consoleError.mockRestore());
  const event: WorkspaceEvent = {
    type: "session.running",
    sessionId: `broadcast-${crypto.randomUUID()}`,
  };
  const received: WorkspaceEvent[] = [];
  const unsubscribeFailed = subscribeWorkspaceEvents(() => {
    throw new Error("client disconnected");
  });
  const unsubscribeHealthy = subscribeWorkspaceEvents((workspaceEvent) => {
    received.push(workspaceEvent);
  });
  onTestFinished(unsubscribeFailed);
  onTestFinished(unsubscribeHealthy);

  const before = getWorkspaceRevision();
  expect(() => broadcast(event)).not.toThrow();
  expect(getWorkspaceRevision()).not.toBe(before);
  expect(received).toEqual([event]);
  expect(consoleError).toHaveBeenCalledWith(
    "Failed to broadcast workspace event:",
    expect.any(Error),
  );
});
