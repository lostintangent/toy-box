import { describe, expect, test } from "bun:test";
import {
  decodeSystemMessage,
  encodeSystemMessage,
  systemMessageCoalesceKey,
  systemMessageLabel,
  systemMessagePrompt,
} from "./systemMessages";

describe("Session system messages", () => {
  test("task checkpoints survive history and do not coalesce distinct expired tasks", () => {
    const message = {
      type: "channel_task_check_in",
      taskId: "build",
      title: "Build",
      checkInAt: "2026-10-23T15:20:00.000Z",
    } as const;
    expect(decodeSystemMessage(encodeSystemMessage(message))).toEqual(message);
    expect(systemMessageLabel(message)).toBe("Task check-in: Build");
    expect(systemMessageCoalesceKey(message)).not.toBe(
      systemMessageCoalesceKey({ ...message, taskId: "verify" }),
    );
  });

  test("a lead message names the sender's channel and server, and never merges with another", () => {
    const message = {
      type: "channel_lead_message",
      channelId: "apple",
      channelName: "Toy Box (Apple)",
      content: "Which build has the fix?\n\n- iOS\n- macOS",
    } as const;
    expect(decodeSystemMessage(encodeSystemMessage(message))).toEqual(message);
    expect(systemMessageLabel(message)).toBe("Message from the lead of Toy Box (Apple)");
    expect(systemMessagePrompt(message)).toContain(JSON.stringify(message.channelId));
    expect(systemMessagePrompt(message)).toContain(JSON.stringify(message.content));
    expect(systemMessageCoalesceKey(message)).toBeUndefined();

    const linked = { ...message, server: "Studio" };
    expect(decodeSystemMessage(encodeSystemMessage(linked))).toEqual(linked);
    expect(systemMessageLabel(linked)).toBe("Message from the lead of Toy Box (Apple) on Studio");
    expect(systemMessagePrompt(linked)).toContain(JSON.stringify(linked.server));
  });

  test("round-trips structured display content separately from the model prompt", () => {
    const message = {
      type: "file_edited",
      file: { kind: "session", sessionId: "s1", path: "résumé 🍣.md" },
    } as const;
    const display = encodeSystemMessage(message);
    expect(display).not.toBe(systemMessagePrompt(message));
    expect(decodeSystemMessage(display)).toEqual(message);
  });

  test("rejects ordinary, malformed, and invalid display content", () => {
    expect(decodeSystemMessage("hello")).toBeUndefined();
    expect(decodeSystemMessage("toybox-system:{bad}")).toBeUndefined();
    expect(
      decodeSystemMessage(
        'toybox-system:{"type":"file_edited","file":{"kind":"session","sessionId":"s1","path":""}}',
      ),
    ).toBeUndefined();
  });

  test("derives presentation and delivery policy from each message", () => {
    const fileEdited = {
      type: "file_edited",
      file: { kind: "session", sessionId: "s1", path: "plan.md" },
    } as const;
    expect(systemMessageLabel(fileEdited)).toBe("Edited plan.md");
    expect(systemMessageCoalesceKey(fileEdited)).toBe("file_edited:session:s1:plan.md");
    expect(systemMessagePrompt(fileEdited)).toContain("Review its latest contents");

    const channelMessage = {
      type: "channel_message",
      senderName: "Research Scout",
    } as const;
    expect(systemMessageLabel(channelMessage)).toBe("Message from Research Scout");
    expect(systemMessageCoalesceKey(channelMessage)).toBe("channel_message");
    expect(systemMessagePrompt(channelMessage)).toContain("Call `read_channel`");
  });
});
