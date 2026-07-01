import { describe, expect, test } from "bun:test";
import { createInitialSession, toSessionSnapshot } from "@/lib/session/sessionReducer";
import { isBatchableEvent } from "./useSession";

describe("useSession helpers", () => {
  describe("isBatchableEvent", () => {
    test("batches high-frequency text and reasoning deltas per frame", () => {
      expect(isBatchableEvent({ type: "delta", content: "x" })).toBe(true);
      expect(isBatchableEvent({ type: "reasoning", content: "x" })).toBe(true);
    });

    test("renders discrete events immediately", () => {
      expect(isBatchableEvent({ type: "status", status: "thinking" })).toBe(false);
      expect(
        isBatchableEvent({ type: "tool_start", toolName: "bash", toolCallId: "t1", arguments: {} }),
      ).toBe(false);
      expect(isBatchableEvent({ type: "end", reason: "idle" })).toBe(false);
    });
  });

  describe("toSessionSnapshot", () => {
    test("maps live session state into the detail query snapshot shape", () => {
      const state = createInitialSession({
        messages: [{ role: "user", content: "hello" }],
        queuedMessages: [{ id: "q1", role: "user", content: "next" }],
        todos: [{ id: "t1", title: "todo", status: "pending" }],
        linkedSessionIds: ["linked-1"],
        artifacts: ["~/.copilot/session-state/session-1/report.md"],
        status: "responding",
        reasoningContent: "thinking...",
        modelConfiguration: { model: "gpt-5.5" },
      });
      state.lastSeenEventId = 42;

      expect(toSessionSnapshot("session-1", state)).toEqual({
        id: "session-1",
        messages: state.messages,
        queuedMessages: state.queuedMessages,
        modelConfiguration: { model: "gpt-5.5" },
        todos: state.todos,
        linkedSessionIds: ["linked-1"],
        artifacts: ["~/.copilot/session-state/session-1/report.md"],
        lastSeenEventId: 42,
        status: "responding",
        reasoningContent: "thinking...",
      });
    });

    test("preserves the previous snapshot's id and falls back to its model configuration", () => {
      const state = createInitialSession();
      const snapshot = toSessionSnapshot("session-new", state, {
        id: "session-existing",
        messages: [],
        queuedMessages: [],
        status: "idle",
        reasoningContent: "",
        modelConfiguration: { model: "claude-opus-4.8" },
      });

      expect(snapshot.id).toBe("session-existing");
      expect(snapshot.modelConfiguration).toEqual({ model: "claude-opus-4.8" });
      // Empty linked sessions collapse to undefined rather than [].
      expect(snapshot.linkedSessionIds).toBeUndefined();
    });
  });
});
