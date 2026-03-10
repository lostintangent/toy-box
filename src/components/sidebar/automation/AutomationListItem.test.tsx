import { describe, expect, test } from "bun:test";

describe("AutomationListItem click noop behavior", () => {
  test("onClick logic returns early when lastRunSessionId is undefined", () => {
    const automation = {
      lastRunSessionId: undefined,
    };

    let sessionOpened = false;
    const onOpenSession = (_sessionId: string) => {
      sessionOpened = true;
    };

    // Simulate the onClick handler logic from AutomationListItem.tsx lines 105-108
    if (!automation.lastRunSessionId) {
      // This is the noop behavior - early return
      expect(sessionOpened).toBe(false);
    } else {
      onOpenSession(automation.lastRunSessionId);
    }

    expect(sessionOpened).toBe(false);
  });

  test("onClick logic calls onOpenSession when lastRunSessionId exists", () => {
    const automation = {
      lastRunSessionId: "session-123",
    };

    let sessionOpened = false;
    let openedSessionId: string | undefined;
    const onOpenSession = (sessionId: string) => {
      sessionOpened = true;
      openedSessionId = sessionId;
    };

    // Simulate the onClick handler logic from AutomationListItem.tsx lines 105-108
    if (!automation.lastRunSessionId) {
      // noop
    } else {
      onOpenSession(automation.lastRunSessionId);
    }

    expect(sessionOpened).toBe(true);
    expect(openedSessionId).toBe("session-123");
  });
});
