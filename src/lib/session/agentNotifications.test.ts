import { describe, expect, test } from "bun:test";
import {
  AGENT_NOTIFICATION_TYPE_INSTRUCTIONS,
  notificationCoalesceKey,
  notificationLabel,
  parseAgentNotification,
} from "./agentNotifications";

describe("agent notifications", () => {
  test("validates notification payloads", () => {
    const notification = { type: "artifact_edited", path: "plan.md" } as const;

    expect(parseAgentNotification(notification)).toEqual(notification);
    expect(parseAgentNotification({ type: "nope" })).toBeUndefined();
    expect(parseAgentNotification({ type: "toString" })).toBeUndefined();
    expect(parseAgentNotification({ type: "artifact_edited", path: "" })).toBeUndefined();
  });

  test("derives a transcript label and a coalesce key", () => {
    const notification = { type: "artifact_edited", path: "plan.md" } as const;

    expect(notificationLabel(notification)).toBe("Edited artifact (plan.md)");
    expect(notificationCoalesceKey(notification)).toBe("artifact_edited:plan.md");
  });

  test("system instructions enumerate every registered type", () => {
    expect(AGENT_NOTIFICATION_TYPE_INSTRUCTIONS).toContain(
      "- artifact_edited: The user edited the artifact at the given `path`. Review its latest contents and respond only if a follow-up would help.",
    );
  });
});
