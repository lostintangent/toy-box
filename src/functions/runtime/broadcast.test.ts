import { expect, onTestFinished, spyOn, test } from "bun:test";
import type { WorkspaceEvent } from "@/types";
import { broadcast, subscribeWorkspaceEvents } from "./broadcast";

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

  expect(() => broadcast(event)).not.toThrow();
  expect(received).toEqual([event]);
  expect(consoleError).toHaveBeenCalledWith(
    "Failed to broadcast workspace event:",
    expect.any(Error),
  );
});
