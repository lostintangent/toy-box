import { describe, expect, test } from "bun:test";
import {
  systemMessageCoalesceKey,
  systemMessageLabel,
  systemMessagePrompt,
} from "./systemMessages";

describe("Session system messages", () => {
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

    const agentHandoff = {
      type: "agent_handoff",
      content: "Post the private decision to the team.",
    } as const;
    expect(systemMessageLabel(agentHandoff)).toBe("Private direction");
    expect(systemMessageCoalesceKey(agentHandoff)).toBeUndefined();
    expect(systemMessagePrompt(agentHandoff)).toContain(agentHandoff.content);

    const agentResponse = {
      type: "agent_response",
      executionMode: "worktree",
      name: "Reviewer",
      content: "The invariant holds.",
    } as const;
    expect(systemMessageLabel(agentResponse)).toBe("Reviewer replied");
    expect(systemMessageCoalesceKey(agentResponse)).toBeUndefined();
    expect(systemMessagePrompt(agentResponse)).toContain("The invariant holds.");
  });
});
