import { describe, expect, test } from "bun:test";
import {
  decodeSystemMessage,
  encodeSystemMessage,
  systemMessageCoalesceKey,
  systemMessageLabel,
  systemMessagePrompt,
} from "./systemMessages";

describe("Session system messages", () => {
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
