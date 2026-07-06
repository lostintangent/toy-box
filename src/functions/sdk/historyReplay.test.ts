import { describe, expect, test } from "bun:test";
import type { SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";
import { initializeSessionStateFromSdkHistory } from "./historyReplay";

function sdkEvent(event: unknown): SdkSessionEvent {
  return event as SdkSessionEvent;
}

describe("history replay", () => {
  test("replays compaction lifecycle through the shared projector and still lands idle", async () => {
    const events = [
      sdkEvent({ type: "user.message", data: { content: "Summarize this" } }),
      sdkEvent({ type: "session.compaction_start", data: {} }),
      sdkEvent({ type: "session.compaction_complete", data: {} }),
      sdkEvent({ type: "assistant.message", data: { content: "Done." } }),
    ];

    const state = await initializeSessionStateFromSdkHistory("history-replay-session", events);

    expect(state.status).toBe("idle");
    expect(state.reasoningContent).toBe("");
    expect(state.pendingToolCalls.size).toBe(0);
    expect(state.messages).toEqual([
      { role: "user", content: "Summarize this", attachments: undefined, timestamp: undefined },
      { role: "assistant", content: "Done." },
    ]);
  });
});
