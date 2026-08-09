import { describe, expect, test } from "bun:test";
import {
  AGENT_NOTIFICATION_TYPE_INSTRUCTIONS,
  notificationCoalesceKey,
  notificationLabel,
  parseAgentNotification,
} from "./agentNotifications";

describe("agent notifications", () => {
  test("validates notification payloads", () => {
    const notification = {
      type: "file_edited",
      file: { type: "session", sessionId: "s1", path: "plan.md" },
    } as const;

    expect(parseAgentNotification(notification)).toEqual(notification);
    expect(parseAgentNotification({ type: "nope" })).toBeUndefined();
    expect(parseAgentNotification({ type: "toString" })).toBeUndefined();
    expect(
      parseAgentNotification({
        type: "file_edited",
        file: { type: "session", sessionId: "s1", path: "" },
      }),
    ).toBeUndefined();
  });

  test("derives a transcript label and a coalesce key", () => {
    const notification = {
      type: "file_edited",
      file: { type: "session", sessionId: "s1", path: "plan.md" },
    } as const;

    expect(notificationLabel(notification)).toBe("Edited plan.md");
    expect(notificationCoalesceKey(notification)).toBe("file_edited:session:s1:plan.md");
  });

  test("system instructions enumerate every registered type", () => {
    expect(AGENT_NOTIFICATION_TYPE_INSTRUCTIONS).toContain(
      "- file_edited: The user edited a file open in Toy Box. A `session` file's `path` is relative to that session's files folder (usually your own); a `machine` file's `path` is an absolute host path. Review its latest contents and respond only if a follow-up would help.",
    );
  });
});
