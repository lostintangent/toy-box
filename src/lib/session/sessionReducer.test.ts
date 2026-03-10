import { describe, expect, test } from "bun:test";
import { applySessionEvent, createInitialSession } from "./sessionReducer";
import type { AssistantMessage } from "@/types";

describe("sessionStateReducer", () => {
  test("replays a streamed turn with tool calls into interleaved assistant messages", () => {
    const state = createInitialSession();
    for (const event of [
      { type: "user_message", content: "hello" },
      { type: "thinking" },
      {
        type: "tool_start",
        toolCallId: "t1",
        toolName: "read_file",
        arguments: { path: "docs/design.md" },
      },
      { type: "tool_end", toolCallId: "t1", success: true, result: "ok" },
      { type: "delta", content: "Done." },
      { type: "stream_end", reason: "idle" },
    ] as const) {
      applySessionEvent(state, event);
    }

    expect(state.messages).toHaveLength(3);
    expect(state.messages[0]).toMatchObject({ role: "user", content: "hello" });
    // First assistant message: tool call group
    expect(state.messages[1].role).toBe("assistant");
    expect((state.messages[1] as AssistantMessage).toolCalls).toHaveLength(1);
    expect((state.messages[1] as AssistantMessage).toolCalls?.[0]).toMatchObject({
      toolCallId: "t1",
      toolName: "read_file",
      result: { content: "ok", success: true },
    });
    // Second assistant message: text after tool calls
    expect(state.messages[2]).toMatchObject({ role: "assistant", content: "Done." });
    expect((state.messages[2] as AssistantMessage).toolCalls).toBeUndefined();
    expect(state.status).toBe("idle");
  });

  test("applies bulk todo status patches to existing todos", () => {
    const state = createInitialSession({
      todos: [
        { id: "oak-task", title: "oak task", status: "pending" },
        { id: "pine-task", title: "pine task", status: "in_progress" },
      ],
    });

    applySessionEvent(state, {
      type: "todos_patch",
      patches: [{ type: "update_all", status: "done" }],
    });

    expect(state.todos).toEqual([
      { id: "oak-task", title: "oak task", status: "done" },
      { id: "pine-task", title: "pine task", status: "done" },
    ]);
  });

  test("consecutive assistant_message events produce separate messages", () => {
    const state = createInitialSession();
    for (const event of [
      {
        type: "assistant_message" as const,
        content: "First",
        toolCalls: [{ toolCallId: "i1", toolName: "report_intent", arguments: { intent: "Plan" } }],
      },
      {
        type: "assistant_message" as const,
        content: "Second",
        toolCalls: [{ toolCallId: "t2", toolName: "glob", arguments: { pattern: "*.ts" } }],
      },
    ]) {
      applySessionEvent(state, event);
    }

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({
      role: "assistant",
      content: "First",
    });
    expect((state.messages[0] as AssistantMessage).toolCalls).toHaveLength(1);
    expect((state.messages[0] as AssistantMessage).toolCalls?.[0].toolName).toBe("report_intent");
    expect(state.messages[1]).toMatchObject({
      role: "assistant",
      content: "Second",
    });
    expect((state.messages[1] as AssistantMessage).toolCalls).toHaveLength(1);
    expect((state.messages[1] as AssistantMessage).toolCalls?.[0].toolName).toBe("glob");
  });

  test("promotes queued message to main messages list", () => {
    const withQueue = createInitialSession({
      queuedMessages: [
        { id: "q1", role: "user", content: "first queued" },
        { id: "q2", role: "user", content: "second queued" },
      ],
      messages: [{ role: "assistant", content: "ready" }],
    });

    const state = applySessionEvent(withQueue, {
      type: "message_dequeued",
      content: "first queued",
      queuedMessageId: "q1",
    });

    expect(state.queuedMessages).toHaveLength(1);
    expect(state.queuedMessages[0]).toMatchObject({
      id: "q2",
      content: "second queued",
    });
    expect(state.messages[state.messages.length - 1]).toMatchObject({
      role: "user",
      content: "first queued",
    });
  });

  test("removes queued message by id when queue order diverges", () => {
    const withQueue = createInitialSession({
      queuedMessages: [
        { id: "q1", role: "user", content: "first queued" },
        { id: "q2", role: "user", content: "second queued" },
      ],
      messages: [{ role: "assistant", content: "ready" }],
    });

    const state = applySessionEvent(withQueue, {
      type: "message_dequeued",
      content: "second queued",
      queuedMessageId: "q2",
    });

    expect(state.queuedMessages).toHaveLength(1);
    expect(state.queuedMessages[0]).toMatchObject({
      id: "q1",
      content: "first queued",
    });
    expect(state.messages[state.messages.length - 1]).toMatchObject({
      role: "user",
      content: "second queued",
    });
  });

  test("adds queued message from cross-client broadcast", () => {
    const state = createInitialSession();

    applySessionEvent(state, {
      type: "message_queued",
      queuedMessageId: "q1",
      content: "follow up",
    });

    expect(state.queuedMessages).toHaveLength(1);
    expect(state.queuedMessages[0]).toMatchObject({ id: "q1", content: "follow up" });
  });

  test("deduplicates message_queued when already present optimistically", () => {
    const state = createInitialSession({
      queuedMessages: [{ id: "q1", role: "user", content: "follow up" }],
    });

    applySessionEvent(state, {
      type: "message_queued",
      queuedMessageId: "q1",
      content: "follow up",
    });

    expect(state.queuedMessages).toHaveLength(1);
  });

  test("removes queued message on message_cancelled", () => {
    const state = createInitialSession({
      queuedMessages: [
        { id: "q1", role: "user", content: "first" },
        { id: "q2", role: "user", content: "second" },
      ],
    });

    applySessionEvent(state, { type: "message_cancelled", queuedMessageId: "q1" });

    expect(state.queuedMessages).toHaveLength(1);
    expect(state.queuedMessages[0]).toMatchObject({ id: "q2", content: "second" });
  });

  test("tracks reasoning status and clears it when a response starts", () => {
    const initial = createInitialSession();
    const afterReasoning = applySessionEvent(initial, {
      type: "reasoning",
      content: "thinking",
    });
    expect(afterReasoning.status).toBe("reasoning");
    expect(afterReasoning.reasoningContent).toBe("thinking");

    const afterDelta = applySessionEvent(afterReasoning, { type: "delta", content: "answer" });
    expect(afterDelta.status).toBe("responding");
    expect(afterDelta.reasoningContent).toBe("");
  });

  test("normalizes cumulative delta chunks without duplicating assistant content", () => {
    const state = createInitialSession();
    applySessionEvent(state, { type: "user_message", content: "go" });
    applySessionEvent(state, { type: "thinking" });

    applySessionEvent(state, { type: "delta", content: "Let me look" });
    applySessionEvent(state, { type: "delta", content: "Let me look at the turn" });
    applySessionEvent(state, {
      type: "delta",
      content: "Let me look at the turn that corresponds",
    });

    expect(state.messages[state.messages.length - 1]).toMatchObject({
      role: "assistant",
      content: "Let me look at the turn that corresponds",
    });
  });

  test("preserves repeated boundary characters for incremental delta chunks", () => {
    const state = createInitialSession();
    applySessionEvent(state, { type: "user_message", content: "go" });
    applySessionEvent(state, { type: "thinking" });

    applySessionEvent(state, { type: "delta", content: "cof" });
    applySessionEvent(state, { type: "delta", content: "fee" });

    expect(state.messages[state.messages.length - 1]).toMatchObject({
      role: "assistant",
      content: "coffee",
    });
  });

  test("normalizes cumulative reasoning chunks without duplication", () => {
    const state = createInitialSession();

    applySessionEvent(state, { type: "reasoning", content: "Now I can" });
    applySessionEvent(state, { type: "reasoning", content: "Now I can see" });
    applySessionEvent(state, {
      type: "reasoning",
      content: "Now I can see the pattern clearly.",
    });

    expect(state.reasoningContent).toBe("Now I can see the pattern clearly.");
  });

  test("tracks event metadata across streamed events", () => {
    const initial = createInitialSession();
    const afterThinking = applySessionEvent(initial, {
      type: "thinking",
      eventId: 10,
      turnId: "turn-1",
    });
    const afterToolStart = applySessionEvent(afterThinking, {
      type: "tool_start",
      toolCallId: "tc-1",
      toolName: "glob",
      arguments: { pattern: "*.ts" },
      eventId: 11,
    });

    expect(afterToolStart.lastSeenEventId).toBe(11);
    expect(afterToolStart.activeTurnId).toBe("turn-1");
  });

  test("deduplicates replayed user messages by clientMessageId", () => {
    const state = createInitialSession();

    applySessionEvent(state, {
      type: "user_message",
      content: "hello",
      clientMessageId: "msg-1",
    });
    expect(state.pendingOptimisticUserMessage).toEqual({ clientMessageId: "msg-1", index: 0 });

    applySessionEvent(state, {
      type: "user_message",
      content: "hello",
      clientMessageId: "msg-1",
      timestamp: "2026-02-09T00:00:00.000Z",
      eventId: 10,
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({
      role: "user",
      content: "hello",
      timestamp: "2026-02-09T00:00:00.000Z",
    });
    expect(state.pendingOptimisticUserMessage).toBeUndefined();
  });

  test("unhandled events do not change status", () => {
    let state = createInitialSession();
    const initialStatus = state.status;

    state = applySessionEvent(state, { type: "intent", intent: "Plan" });
    expect(state.status).toEqual(initialStatus);

    state = applySessionEvent(state, {
      type: "tool_start",
      toolCallId: "tc-2",
      toolName: "search",
      arguments: { query: "tanstack" },
    });
    expect(state.status).toEqual(initialStatus);
  });

  test("applies structured todo patches and clears transient state at stream end", () => {
    let state = createInitialSession();
    state = applySessionEvent(state, { type: "thinking" });
    state = applySessionEvent(state, { type: "reasoning", content: "analyzing" });
    state = applySessionEvent(state, {
      type: "tool_start",
      toolCallId: "tc-3",
      toolName: "read_file",
      arguments: { path: "README.md" },
    });
    state = applySessionEvent(state, {
      type: "todos_patch",
      patches: [{ type: "upsert", id: "one", title: "one", status: "pending" }],
    });
    expect(state.todos).toEqual([{ id: "one", title: "one", status: "pending" }]);
    expect(state.pendingToolCalls.size).toBe(1);

    state = applySessionEvent(state, {
      type: "todos_patch",
      patches: [{ type: "upsert", id: "one", status: "done" }],
    });
    expect(state.todos).toEqual([{ id: "one", title: "one", status: "done" }]);

    state = applySessionEvent(state, {
      type: "todos_patch",
      patches: [{ type: "delete", id: "one" }],
    });
    expect(state.todos).toBeUndefined();

    state = applySessionEvent(state, { type: "stream_end", reason: "idle" });
    expect(state.status).toBe("idle");
    expect(state.status).toBe("idle");
    expect(state.reasoningContent).toBe("");
    expect(state.pendingToolCalls.size).toBe(0);
  });

  test("mutates state in-place", () => {
    const state = createInitialSession();
    const sameRef = applySessionEvent(state, { type: "thinking" });
    expect(sameRef).toBe(state);
    expect(state.status).toBe("thinking");
  });

  test("stores session title updates from metadata events", () => {
    const state = createInitialSession();
    applySessionEvent(state, { type: "session_title_changed", title: "Friendly title" });
    expect(state.summary).toBe("Friendly title");
  });

  test("empty deltas do not fragment messages or clear pending tool calls", () => {
    const state = createInitialSession();
    applySessionEvent(state, { type: "user_message", content: "go" });
    applySessionEvent(state, { type: "thinking" });
    applySessionEvent(state, {
      type: "tool_start",
      toolCallId: "t1",
      toolName: "edit",
      arguments: { path: "file.ts", old_str: "a", new_str: "b" },
    });

    // An empty delta arriving mid-tool-execution must be ignored.
    // Previously it called ensureCleanAssistantMessage, which cleared
    // pendingToolCalls and created a new message — dropping the tool
    // call result when tool_end arrived afterward.
    applySessionEvent(state, { type: "delta", content: "" });

    expect(state.pendingToolCalls.size).toBe(1);
    // Only user + 1 assistant message (no spurious empty message)
    expect(state.messages).toHaveLength(2);
    expect((state.messages[1] as AssistantMessage).toolCalls).toHaveLength(1);

    // tool_end should find the tool call and attach the result
    applySessionEvent(state, {
      type: "tool_end",
      toolCallId: "t1",
      success: true,
      result: "applied",
    });
    expect((state.messages[1] as AssistantMessage).toolCalls?.[0].result).toEqual({
      content: "applied",
      success: true,
    });
  });

  test("tracks compacting status and returns to thinking when done", () => {
    let state = createInitialSession();
    state = applySessionEvent(state, { type: "thinking" });
    expect(state.status).toBe("thinking");

    state = applySessionEvent(state, { type: "compacting_start" });
    expect(state.status).toBe("compacting");

    // Idempotent: duplicate start is a no-op
    state = applySessionEvent(state, { type: "compacting_start" });
    expect(state.status).toBe("compacting");

    state = applySessionEvent(state, { type: "compacting_end" });
    expect(state.status).toBe("thinking");

    // End while not compacting is a no-op
    state = applySessionEvent(state, { type: "compacting_end" });
    expect(state.status).toBe("thinking");
  });
});
