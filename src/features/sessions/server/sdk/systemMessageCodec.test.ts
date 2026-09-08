import { describe, expect, test } from "bun:test";
import type { SessionSystemMessage } from "@sessions/model";
import { fromSdkSystemMessage, toSdkSystemMessage } from "./systemMessageCodec";

describe("SDK system message codec", () => {
  test("separates model instructions from durable transcript content", () => {
    const message = {
      type: "agent_response",
      executionMode: "worktree",
      name: "Reviewer",
      content: "The invariant holds.",
    } satisfies SessionSystemMessage;

    const encoded = toSdkSystemMessage(message);

    expect(encoded.prompt).toContain("The invariant holds.");
    expect(encoded.displayPrompt).not.toBe(encoded.prompt);
    expect(fromSdkSystemMessage(encoded.displayPrompt)).toEqual(message);
  });

  test("rejects ordinary and malformed user messages", () => {
    expect(fromSdkSystemMessage("hello")).toBeUndefined();
    expect(fromSdkSystemMessage("toybox-system:{bad}")).toBeUndefined();
    expect(
      fromSdkSystemMessage(
        'toybox-system:{"type":"file_edited","file":{"kind":"session","sessionId":"s1","path":""}}',
      ),
    ).toBeUndefined();
  });
});
