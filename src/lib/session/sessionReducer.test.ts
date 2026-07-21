import { describe, expect, test } from "bun:test";
import {
  applySessionEvent,
  createInitialSession,
  prepareSessionForNextTurn,
  sessionSeedFromSnapshot,
  toSessionSnapshot,
  type Session,
} from "./sessionReducer";
import type { AssistantMessage, Message, SessionEvent } from "@/types";

function reduceEvents(events: readonly SessionEvent[], initial = createInitialSession()): Session {
  return events.reduce(applySessionEvent, initial);
}

function assistantMessageAt(state: Session, index: number): AssistantMessage {
  const message = state.messages[index];
  if (message?.role !== "assistant") {
    throw new Error(`Expected assistant message at index ${index}`);
  }
  return message;
}

function expectMessageIdentities(
  previous: Message[],
  next: Message[],
  count = previous.length,
): void {
  for (let index = 0; index < count; index++) {
    expect(next[index]).toBe(previous[index]);
  }
}

describe("sessionReducer", () => {
  describe("messages", () => {
    test("replays a streamed turn with tool calls into interleaved assistant messages", () => {
      const state = reduceEvents([
        { type: "user_message", content: "hello" },
        { type: "status", status: "thinking" },
        {
          type: "tool_start",
          toolCallId: "t1",
          toolName: "read_file",
          arguments: { path: "README.md" },
        },
        { type: "tool_end", toolCallId: "t1", success: true, result: "ok" },
        { type: "delta", content: "Done." },
        { type: "end", reason: "idle" },
      ]);

      expect(state.messages).toHaveLength(3);
      expect(state.messages[0]).toMatchObject({ role: "user", content: "hello" });
      // First assistant message: tool call group
      expect(state.messages[1].role).toBe("assistant");
      expect(assistantMessageAt(state, 1).toolCalls).toHaveLength(1);
      expect(assistantMessageAt(state, 1).toolCalls?.[0]).toMatchObject({
        id: "t1",
        name: "read_file",
        result: {
          content: "ok",
          success: true,
        },
      });
      // Second assistant message: text after tool calls
      expect(state.messages[2]).toMatchObject({ role: "assistant", content: "Done." });
      expect(assistantMessageAt(state, 2).toolCalls).toBeUndefined();
      expect(state.status).toBe("idle");
    });

    test("committed assistant messages produce separate messages and finalize pending tool calls", () => {
      // Replay interleaving: a committed message's tools attach via the
      // pending map, and the next committed message is a turn boundary that
      // must not drag the previous group's tool calls along.
      const state = reduceEvents([
        { type: "assistant_message", content: "First" },
        {
          type: "tool_start",
          toolCallId: "t1",
          toolName: "glob",
          arguments: { pattern: "*.ts" },
        },
        { type: "tool_end", toolCallId: "t1", success: true, result: "ok" },
        { type: "assistant_message", content: "Second" },
      ]);

      expect(state.messages).toHaveLength(2);
      expect(state.messages[0]).toMatchObject({
        role: "assistant",
        content: "First",
      });
      expect(assistantMessageAt(state, 0).toolCalls).toHaveLength(1);
      expect(assistantMessageAt(state, 0).toolCalls?.[0]).toMatchObject({
        id: "t1",
        name: "glob",
        result: { content: "ok", success: true },
      });
      expect(state.messages[1]).toMatchObject({
        role: "assistant",
        content: "Second",
      });
      expect(assistantMessageAt(state, 1).toolCalls).toBeUndefined();
      expect(state.pendingToolCalls.size).toBe(0);
    });

    test("committed assistant messages append after thinking status", () => {
      const state = reduceEvents([
        { type: "user_message", content: "go" },
        { type: "status", status: "thinking" },
        { type: "assistant_message", content: "Done." },
      ]);

      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]).toMatchObject({ role: "assistant", content: "Done." });
      expect(state.status).toBe("responding");
    });

    test("agent notifications create visible turn boundaries", () => {
      const notification = { type: "artifact_edited", path: "plan.md" } as const;
      const state = reduceEvents([
        { type: "agent_notification", notification },
        { type: "status", status: "thinking" },
        { type: "assistant_message", content: "I reviewed the edit." },
        { type: "agent_notification", notification },
        { type: "status", status: "thinking" },
        { type: "assistant_message", content: "I reviewed the update." },
      ]);

      expect(state.messages).toEqual([
        { role: "agent_notification", notification, timestamp: undefined },
        { role: "assistant", content: "I reviewed the edit." },
        { role: "agent_notification", notification, timestamp: undefined },
        { role: "assistant", content: "I reviewed the update." },
      ]);
      expect(state.status).toBe("responding");
    });

    test("committed assistant messages reconcile streamed assistant text", () => {
      const state = reduceEvents([
        { type: "user_message", content: "go" },
        { type: "status", status: "thinking" },
        { type: "delta", content: "Done" },
        { type: "delta", content: "Done." },
        { type: "assistant_message", content: "Done." },
      ]);

      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]).toMatchObject({ role: "assistant", content: "Done." });
      expect(state.status).toBe("responding");
    });

    test("committed assistant messages reconcile after reasoning without a text delta", () => {
      const state = reduceEvents([
        { type: "user_message", content: "go" },
        { type: "status", status: "thinking" },
        { type: "reasoning", content: "Thinking..." },
        { type: "assistant_message", content: "Done." },
      ]);

      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]).toMatchObject({ role: "assistant", content: "Done." });
      expect(state.status).toBe("responding");
      expect(state.reasoningContent).toBe("");
    });
  });

  describe("streaming content", () => {
    test("status updates do not create assistant messages", () => {
      const state = reduceEvents([
        { type: "user_message", content: "go" },
        { type: "status", status: "thinking" },
      ]);

      expect(state.status).toBe("thinking");
      expect(state.reasoningContent).toBe("");
      expect(state.messages).toEqual([
        { role: "user", content: "go", attachments: undefined, timestamp: undefined },
      ]);
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
      const state = reduceEvents([
        { type: "user_message", content: "go" },
        { type: "status", status: "thinking" },
        { type: "delta", content: "Let me look" },
        { type: "delta", content: "Let me look at the turn" },
        { type: "delta", content: "Let me look at the turn that corresponds" },
      ]);

      expect(state.messages[state.messages.length - 1]).toMatchObject({
        role: "assistant",
        content: "Let me look at the turn that corresponds",
      });
    });

    test("preserves repeated boundary characters for incremental delta chunks", () => {
      const state = reduceEvents([
        { type: "user_message", content: "go" },
        { type: "status", status: "thinking" },
        { type: "delta", content: "cof" },
        { type: "delta", content: "fee" },
      ]);

      expect(state.messages[state.messages.length - 1]).toMatchObject({
        role: "assistant",
        content: "coffee",
      });
    });

    test("replaces only the growing assistant message for streamed deltas", () => {
      let state = createInitialSession({
        messages: [
          { role: "user", content: "go" },
          { role: "assistant", content: "First" },
        ],
        status: "responding",
      });
      const previousState = state;
      const previousMessages = state.messages;
      const previousUserMessage = state.messages[0];
      const previousAssistantMessage = assistantMessageAt(state, 1);

      state = applySessionEvent(state, { type: "delta", content: " update" });

      expect(state).not.toBe(previousState);
      expect(state.messages).not.toBe(previousMessages);
      expect(state.messages[0]).toBe(previousUserMessage);
      expect(state.messages[1]).not.toBe(previousAssistantMessage);
      expect(state.messages[1]).toMatchObject({ content: "First update" });
      expect(previousAssistantMessage.content).toBe("First");
    });

    test("normalizes cumulative reasoning chunks without duplication", () => {
      const state = reduceEvents([
        { type: "reasoning", content: "Now I can" },
        { type: "reasoning", content: "Now I can see" },
        { type: "reasoning", content: "Now I can see the pattern clearly." },
      ]);

      expect(state.reasoningContent).toBe("Now I can see the pattern clearly.");
    });

    test("routes scoped reasoning chunks into the matching agent tool call", () => {
      const state = reduceEvents([
        { type: "status", status: "thinking" },
        {
          type: "tool_start",
          toolCallId: "agent-1",
          toolName: "agent",
          arguments: { agent_type: "explore" },
        },
        { type: "reasoning", agentId: "agent-1", content: "Inspecting" },
        { type: "reasoning", agentId: "agent-1", content: "Inspecting files" },
      ]);

      const message = assistantMessageAt(state, 0);
      expect(message.toolCalls?.[0].agent?.reasoningContent).toBe("Inspecting files");
      expect(state.reasoningContent).toBe("");
      expect(state.status).toBe("thinking");
    });

    test("accumulates scoped assistant messages on the matching agent tool call", () => {
      const state = reduceEvents([
        { type: "status", status: "thinking" },
        {
          type: "tool_start",
          toolCallId: "agent-1",
          toolName: "agent",
          arguments: { agent_type: "explore" },
        },
        { type: "assistant_message", agentId: "agent-1", content: "Reading files" },
        { type: "assistant_message", agentId: "agent-1", content: "Summarizing findings" },
      ]);

      const message = assistantMessageAt(state, 0);
      expect(message.toolCalls?.[0].agent?.content).toBe("Reading files\n\nSummarizing findings");
      expect(state.messages).toHaveLength(1);
    });

    test("empty deltas do not fragment messages or clear pending tool calls", () => {
      let state = createInitialSession();
      state = applySessionEvent(state, { type: "user_message", content: "go" });
      state = applySessionEvent(state, { type: "status", status: "thinking" });
      state = applySessionEvent(state, {
        type: "tool_start",
        toolCallId: "t1",
        toolName: "edit",
        arguments: { path: "file.ts", old_str: "a", new_str: "b" },
      });

      // An empty delta arriving mid-tool-execution must be ignored.
      // Previously it called ensureCleanAssistantMessage, which cleared
      // pendingToolCalls and created a new message — dropping the tool
      // call result when tool_end arrived afterward.
      state = applySessionEvent(state, { type: "delta", content: "" });

      expect(state.pendingToolCalls.size).toBe(1);
      // Only user + 1 assistant message (no spurious empty message)
      expect(state.messages).toHaveLength(2);
      expect(assistantMessageAt(state, 1).toolCalls).toHaveLength(1);

      // tool_end should find the tool call and attach the result
      state = applySessionEvent(state, {
        type: "tool_end",
        toolCallId: "t1",
        success: true,
        result: "applied",
      });
      expect(assistantMessageAt(state, 1).toolCalls?.[0]).toMatchObject({
        result: {
          content: "applied",
          success: true,
        },
      });
    });
  });

  describe("tool calls", () => {
    test("stores tool result details on completed tool calls", () => {
      const state = reduceEvents([
        {
          type: "tool_start",
          toolCallId: "patch-1",
          toolName: "patch",
          arguments: { patch: "*** Begin Patch\n*** End Patch" },
        },
        {
          type: "tool_end",
          toolCallId: "patch-1",
          success: true,
          result: "Modified 1 file(s)",
          details: "diff --git a/file b/file",
        },
      ]);

      const message = assistantMessageAt(state, 0);
      expect(message.toolCalls?.[0]).toMatchObject({
        result: {
          content: "Modified 1 file(s)",
          success: true,
          details: "diff --git a/file b/file",
        },
      });
    });

    test("nests subagent tool calls under their pending parent agent call", () => {
      const state = reduceEvents([
        { type: "status", status: "thinking" },
        {
          type: "tool_start",
          toolCallId: "agent-1",
          toolName: "agent",
          arguments: { agentName: "explore" },
        },
        {
          type: "tool_start",
          toolCallId: "child-1",
          toolName: "read",
          arguments: { path: "a.ts" },
          agentId: "agent-1",
        },
        {
          type: "tool_end",
          toolCallId: "child-1",
          success: true,
          result: "contents",
          agentId: "agent-1",
        },
        {
          type: "tool_end",
          toolCallId: "agent-1",
          success: true,
          result: "Review complete",
        },
      ]);

      const message = assistantMessageAt(state, 0);
      // The child is nested, not a top-level tool call.
      expect(message.toolCalls).toHaveLength(1);
      const parent = message.toolCalls?.[0];
      expect(parent).toMatchObject({
        id: "agent-1",
        name: "agent",
        result: { content: "Review complete", success: true },
      });
      expect(parent?.agent?.toolCalls).toHaveLength(1);
      expect(parent?.agent?.toolCalls?.[0]).toMatchObject({
        id: "child-1",
        name: "read",
        result: { content: "contents", success: true },
      });
    });

    test("routes scoped model changes into the matching agent tool call", () => {
      const state = reduceEvents([
        { type: "status", status: "thinking" },
        {
          type: "tool_start",
          toolCallId: "agent-1",
          toolName: "agent",
          arguments: { agent_type: "explore" },
        },
        {
          type: "model_changed",
          agentId: "agent-1",
          model: { name: "claude-haiku-4.5" },
        },
      ]);

      const message = assistantMessageAt(state, 0);
      expect(message.toolCalls?.[0].agent?.model).toEqual({
        name: "claude-haiku-4.5",
      });
      expect(state.model).toBeUndefined();
    });

    test("replaces a committed parent as late subagent tool calls change", () => {
      // Resume-mid-turn: the parent agent call arrived committed in a server
      // snapshot (initial state), then live child events arrive for it.
      let state = createInitialSession({
        messages: [
          {
            role: "assistant",
            content: "Kicking off review.",
            toolCalls: [{ id: "agent-1", name: "agent", arguments: { agentName: "explore" } }],
          },
          { role: "assistant", content: "Continuing in the meantime." },
        ],
      });
      const originalMessages = state.messages;
      const originalParentMessage = assistantMessageAt(state, 0);
      const unaffectedMessage = state.messages[1];

      state = applySessionEvent(state, {
        type: "tool_start",
        toolCallId: "child-1",
        toolName: "bash",
        arguments: { command: "ls" },
        agentId: "agent-1",
      });
      const startedParentMessage = assistantMessageAt(state, 0);

      expect(state.messages).not.toBe(originalMessages);
      expect(startedParentMessage).not.toBe(originalParentMessage);
      expect(state.messages[1]).toBe(unaffectedMessage);
      expect(originalParentMessage.toolCalls?.[0].agent?.toolCalls).toBeUndefined();
      expect(startedParentMessage.toolCalls?.[0].agent?.toolCalls?.[0].id).toBe("child-1");
      expect(startedParentMessage.toolCalls?.[0].agent?.toolCalls?.[0].result).toBeUndefined();

      state = applySessionEvent(state, {
        type: "tool_end",
        toolCallId: "child-1",
        success: true,
        result: "ok",
        agentId: "agent-1",
      });
      const completedParentMessage = assistantMessageAt(state, 0);

      expect(completedParentMessage).not.toBe(startedParentMessage);
      expect(state.messages[1]).toBe(unaffectedMessage);
      expect(completedParentMessage.toolCalls).toHaveLength(1);
      expect(completedParentMessage.toolCalls?.[0].agent?.toolCalls).toHaveLength(1);
      expect(completedParentMessage.toolCalls?.[0].agent?.toolCalls?.[0]).toMatchObject({
        id: "child-1",
        result: { content: "ok", success: true },
      });
      expect(startedParentMessage.toolCalls?.[0].agent?.toolCalls?.[0].result).toBeUndefined();
    });

    test("completes a committed root tool call after a message boundary (late background completion)", () => {
      // A background agent task is started, the assistant moves on (text
      // after the tool group commits the call and clears pending), and the
      // deferred completion (subagent.completed → tool_end) arrives later.
      let state = createInitialSession();
      state = applySessionEvent(state, {
        type: "delta",
        content: "Kicking off a background review.",
      });
      state = applySessionEvent(state, {
        type: "tool_start",
        toolCallId: "task-1",
        toolName: "agent",
        arguments: { mode: "background" },
      });
      state = applySessionEvent(state, { type: "delta", content: "Continuing while it runs." });

      const previousMessages = state.messages;
      const committedMessage = assistantMessageAt(state, 0);
      const currentMessage = state.messages[1];
      expect(state.pendingToolCalls.size).toBe(0);

      state = applySessionEvent(state, {
        type: "tool_end",
        toolCallId: "task-1",
        success: true,
      });

      const completedMessage = assistantMessageAt(state, 0);
      expect(state.messages).not.toBe(previousMessages);
      expect(completedMessage).not.toBe(committedMessage);
      expect(state.messages[1]).toBe(currentMessage);
      expect(completedMessage.toolCalls?.[0]).toMatchObject({
        id: "task-1",
        result: { content: "", success: true },
      });
      expect(committedMessage.toolCalls?.[0].result).toBeUndefined();
    });

    test("ignores child tool events whose parent is unknown", () => {
      const state = reduceEvents([
        { type: "status", status: "thinking" },
        {
          type: "tool_start",
          toolCallId: "child-x",
          toolName: "bash",
          arguments: {},
          agentId: "missing-parent",
        },
        {
          type: "tool_end",
          toolCallId: "child-x",
          success: true,
          result: "ok",
          agentId: "missing-parent",
        },
      ]);

      expect(assistantMessageAt(state, 0).toolCalls).toBeUndefined();
    });
  });

  describe("queued messages", () => {
    test("message_dequeued removes exactly one queue item without changing the transcript", () => {
      const state = applySessionEvent(
        createInitialSession({
          queuedMessages: [
            { id: "q1", role: "user", content: "first queued" },
            { id: "q2", role: "user", content: "second queued" },
          ],
          messages: [{ role: "assistant", content: "ready" }],
        }),
        {
          type: "message_dequeued",
          queuedMessageId: "q2",
        },
      );

      expect(state.queuedMessages).toEqual([{ id: "q1", role: "user", content: "first queued" }]);
      expect(state.messages).toEqual([{ role: "assistant", content: "ready" }]);
    });

    test("keeps an identical delivered steer distinct from the opening message", () => {
      let state = createInitialSession({
        messages: [{ role: "user", content: "same prompt" }],
        queuedMessages: [{ id: "q1", role: "user", content: "same prompt", isSteering: true }],
        activeTurnId: "turn-1",
      });
      state = applySessionEvent(state, {
        type: "user_message",
        content: "same prompt",
        isSteered: true,
        turnId: "turn-1",
      });
      state = applySessionEvent(state, { type: "status", status: "thinking" });
      state = applySessionEvent(state, { type: "delta", content: "Steering response." });
      state = applySessionEvent(state, {
        type: "assistant_message",
        content: "Steering response.",
      });

      expect(state.queuedMessages).toEqual([]);
      expect(state.messages).toEqual([
        { role: "user", content: "same prompt" },
        { role: "user", content: "same prompt", attachments: undefined, timestamp: undefined },
        { role: "assistant", content: "Steering response." },
      ]);
    });

    test("adds queued message from cross-client queue update", () => {
      let state = createInitialSession();

      state = applySessionEvent(state, {
        type: "message_queued",
        message: { id: "q1", role: "user", content: "follow up" },
      });

      expect(state.queuedMessages).toHaveLength(1);
      expect(state.queuedMessages[0]).toMatchObject({ id: "q1", content: "follow up" });
    });

    test("updates an existing queue entry when steering begins", () => {
      let state = createInitialSession({
        queuedMessages: [{ id: "q1", role: "user", content: "follow up" }],
      });

      state = applySessionEvent(state, {
        type: "message_queued",
        message: { id: "q1", role: "user", content: "follow up", isSteering: true },
      });

      expect(state.queuedMessages).toEqual([
        { id: "q1", role: "user", content: "follow up", isSteering: true },
      ]);
    });

    test("removes queued message on message_cancelled", () => {
      let state = createInitialSession({
        queuedMessages: [
          { id: "q1", role: "user", content: "first" },
          { id: "q2", role: "user", content: "second" },
        ],
      });

      state = applySessionEvent(state, { type: "message_cancelled", queuedMessageId: "q1" });

      expect(state.queuedMessages).toHaveLength(1);
      expect(state.queuedMessages[0]).toMatchObject({ id: "q2", content: "second" });
    });
  });

  describe("lifecycle & status", () => {
    test("prepareSessionForNextTurn preserves durable state while clearing turn-scoped state", () => {
      const previousState = createInitialSession({
        messages: [
          { role: "user", content: "Open the ocean session" },
          { role: "assistant", content: "Done." },
        ],
        queuedMessages: [{ id: "queued-1", role: "user", content: "Now summarize it" }],
        todos: [{ id: "todo-1", title: "Inspect stream state", status: "in_progress" }],
        linkedSessionIds: ["session-1", "session-2"],
        status: "responding",
        reasoningContent: "thinking...",
        model: { name: "claude-sonnet-4.6" },
      });
      previousState.pendingToolCalls.set("tool-1", {
        id: "tool-1",
        name: "open_session",
        arguments: { sessionId: "session-1" },
      });

      const nextState = prepareSessionForNextTurn(previousState);

      expect(nextState).not.toBe(previousState);
      expect(nextState.messages).toBe(previousState.messages);
      expect(nextState.queuedMessages).toBe(previousState.queuedMessages);
      expect(nextState.todos).toBe(previousState.todos);
      expect(nextState.linkedSessionIds).toBe(previousState.linkedSessionIds);
      expect(nextState.messages).toEqual([
        { role: "user", content: "Open the ocean session" },
        { role: "assistant", content: "Done." },
      ]);
      expect(nextState.todos).toEqual([
        { id: "todo-1", title: "Inspect stream state", status: "in_progress" },
      ]);
      expect(nextState.linkedSessionIds).toEqual(["session-1", "session-2"]);
      expect(nextState.model).toEqual({ name: "claude-sonnet-4.6" });
      expect(nextState.queuedMessages).toEqual([
        { id: "queued-1", role: "user", content: "Now summarize it" },
      ]);

      expect(nextState.reasoningContent).toBe("");
      expect(nextState.status).toBe("thinking");
      expect(nextState.pendingToolCalls.size).toBe(0);
      expect(nextState.pendingOptimisticUserMessage).toBeUndefined();
      expect(previousState.status).toBe("responding");
      expect(previousState.reasoningContent).toBe("thinking...");
      expect(previousState.pendingToolCalls.size).toBe(1);
    });

    test("end/error replaces a partial assistant message with the error notice", () => {
      const state = reduceEvents([
        { type: "user_message", content: "go" },
        { type: "status", status: "thinking" },
        { type: "delta", content: "partial resp" },
        { type: "end", reason: "error" },
      ]);

      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]).toMatchObject({
        role: "assistant",
        content: "An error occurred. Please try again.",
      });
      expect(state.status).toBe("idle");
      expect(state.reasoningContent).toBe("");
      expect(state.pendingToolCalls.size).toBe(0);
    });

    test("end/error appends an assistant message when none is trailing", () => {
      const state = reduceEvents([
        { type: "user_message", content: "go" },
        { type: "end", reason: "error" },
      ]);

      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]).toMatchObject({
        role: "assistant",
        content: "An error occurred. Please try again.",
      });
      expect(state.status).toBe("idle");
    });

    test("a synthesized end/idle does not clobber an earlier end/error", () => {
      const state = reduceEvents([
        { type: "user_message", content: "go" },
        { type: "end", reason: "error" },
        { type: "end", reason: "idle" },
      ]);

      expect(state.messages.at(-1)).toMatchObject({
        role: "assistant",
        content: "An error occurred. Please try again.",
      });
      expect(state.status).toBe("idle");
    });

    test("tracks compacting status and returns to thinking when done", () => {
      let state = createInitialSession();
      state = applySessionEvent(state, { type: "status", status: "thinking" });
      expect(state.status).toBe("thinking");

      state = applySessionEvent(state, { type: "status", status: "compacting" });
      expect(state.status).toBe("compacting");

      // Idempotent: duplicate status update is a no-op in practice.
      state = applySessionEvent(state, { type: "status", status: "compacting" });
      expect(state.status).toBe("compacting");

      state = applySessionEvent(state, { type: "status", status: "thinking" });
      expect(state.status).toBe("thinking");

      // Re-applying the current status preserves it.
      state = applySessionEvent(state, { type: "status", status: "thinking" });
      expect(state.status).toBe("thinking");
    });

    test("tool events without a status transition preserve the current status", () => {
      let state = createInitialSession();
      const initialStatus = state.status;

      state = applySessionEvent(state, {
        type: "tool_start",
        toolCallId: "tc-2",
        toolName: "search",
        arguments: { query: "tanstack" },
      });
      expect(state.status).toEqual(initialStatus);
    });
  });

  describe("event replay & dedup", () => {
    test("tracks event metadata across streamed events", () => {
      const initial = createInitialSession();
      const afterThinking = applySessionEvent(initial, {
        type: "status",
        status: "thinking",
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

    test("skips replayed events that are older than the current snapshot", () => {
      let state = createInitialSession({
        messages: [{ role: "user", content: "already synced" }],
      });
      state.lastSeenEventId = 20;

      state = applySessionEvent(state, {
        type: "user_message",
        content: "already synced",
        eventId: 20,
      });
      state = applySessionEvent(state, {
        type: "assistant_message",
        content: "stale response",
        eventId: 19,
      });

      expect(state.messages).toEqual([{ role: "user", content: "already synced" }]);
      expect(state.lastSeenEventId).toBe(20);
    });

    test("keeps optimistic local events and newer stream events after stale-event filtering", () => {
      let state = createInitialSession();
      state.lastSeenEventId = 20;

      state = applySessionEvent(state, {
        type: "user_message",
        content: "optimistic",
        clientMessageId: "client-1",
      });
      state = applySessionEvent(state, {
        type: "assistant_message",
        content: "new response",
        eventId: 21,
      });

      expect(state.messages).toEqual([
        { role: "user", content: "optimistic" },
        { role: "assistant", content: "new response", toolCalls: undefined },
      ]);
      expect(state.lastSeenEventId).toBe(21);
    });

    test("reconciles an optimistic opening message with its canonical server event", () => {
      let state = createInitialSession();
      state = applySessionEvent(state, {
        type: "user_message",
        content: "hello",
        clientMessageId: "msg-1",
      });
      state = applySessionEvent(state, {
        type: "user_message",
        content: "hello",
        clientMessageId: "msg-1",
        timestamp: "2026-02-09T00:00:00.000Z",
        eventId: 10,
        turnId: "turn-1",
      });
      state = applySessionEvent(state, {
        type: "user_message",
        content: "hello",
        eventId: 11,
        turnId: "turn-1",
      });

      expect(state.messages).toEqual([
        {
          role: "user",
          content: "hello",
          attachments: undefined,
          timestamp: "2026-02-09T00:00:00.000Z",
        },
      ]);
      expect(state.pendingOptimisticUserMessage).toBeUndefined();
    });

    test("does not reconcile an unrelated id-less user message as the opening echo", () => {
      let state = createInitialSession();
      state = applySessionEvent(state, {
        type: "user_message",
        content: "opening prompt",
        clientMessageId: "msg-1",
      });
      state = applySessionEvent(state, {
        type: "user_message",
        content: "different message",
      });

      expect(state.messages.map((message) => message.role === "user" && message.content)).toEqual([
        "opening prompt",
        "different message",
      ]);
    });
  });

  describe("todos & metadata", () => {
    test("applies bulk todo status patches to existing todos", () => {
      let state = createInitialSession({
        todos: [
          { id: "oak-task", title: "oak task", status: "pending" },
          { id: "pine-task", title: "pine task", status: "in_progress" },
        ],
      });

      state = applySessionEvent(state, {
        type: "todos_patch",
        patches: [{ type: "update_all", status: "done" }],
      });

      expect(state.todos).toEqual([
        { id: "oak-task", title: "oak task", status: "done" },
        { id: "pine-task", title: "pine task", status: "done" },
      ]);
    });

    test("applies structured todo patches and clears transient state at end", () => {
      let state = createInitialSession();
      state = applySessionEvent(state, { type: "status", status: "thinking" });
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

      state = applySessionEvent(state, { type: "end", reason: "idle" });
      expect(state.status).toBe("idle");
      expect(state.reasoningContent).toBe("");
      expect(state.pendingToolCalls.size).toBe(0);
    });

    test("stores session title updates from metadata events", () => {
      let state = createInitialSession();
      state = applySessionEvent(state, { type: "session_title_changed", title: "Friendly title" });
      expect(state.summary).toBe("Friendly title");
    });
  });

  describe("artifacts", () => {
    test("appends artifact paths and includes them in snapshots", () => {
      let state = createInitialSession();

      state = applySessionEvent(state, {
        type: "artifacts_patch",
        patches: [{ type: "upsert", path: "report.md" }],
      });
      state = applySessionEvent(state, {
        type: "artifacts_patch",
        patches: [{ type: "upsert", path: "report.md" }],
      });
      state = applySessionEvent(state, {
        type: "artifacts_patch",
        patches: [{ type: "upsert", path: "notes.md" }],
      });

      expect(state.artifacts).toEqual(["report.md", "notes.md"]);
      expect(toSessionSnapshot("session-1", state).artifacts).toEqual(state.artifacts);
    });

    test("removes deleted artifact paths", () => {
      let state = createInitialSession({
        artifacts: ["report.md", "notes.md"],
      });

      state = applySessionEvent(state, {
        type: "artifacts_patch",
        patches: [{ type: "delete", path: "report.md" }],
      });

      expect(state.artifacts).toEqual(["notes.md"]);
    });
  });

  describe("canvases", () => {
    test("stores opened canvases and bumps revision when the same instance opens again", () => {
      let state = createInitialSession();

      state = applySessionEvent(state, {
        type: "canvas_opened",
        canvas: {
          extensionId: "user:documint",
          canvasId: "documint-markdown-agent",
          instanceId: "review-plan",
          title: "Review Plan",
          url: "http://127.0.0.1:51460/?instanceId=review-plan",
          status: "session-state/plan.md",
        },
      });
      state = applySessionEvent(state, {
        type: "canvas_opened",
        canvas: {
          extensionId: "user:documint",
          canvasId: "documint-markdown-agent",
          instanceId: "review-plan",
          title: "Review Plan",
          url: "http://127.0.0.1:53950/?instanceId=review-plan",
        },
      });

      expect(state.canvases).toEqual([
        {
          key: JSON.stringify(["user:documint", "documint-markdown-agent", "review-plan"]),
          extensionId: "user:documint",
          canvasId: "documint-markdown-agent",
          instanceId: "review-plan",
          title: "Review Plan",
          url: "http://127.0.0.1:53950/?instanceId=review-plan",
          revision: 2,
        },
      ]);
      expect(toSessionSnapshot("session-1", state).canvases).toEqual(state.canvases);
    });

    test("keeps different canvas instances as separate panes", () => {
      let state = createInitialSession();

      state = applySessionEvent(state, {
        type: "canvas_opened",
        canvas: {
          extensionId: "session:canvas-ontology",
          extensionName: "canvas-ontology",
          canvasId: "canvas-ontology",
          instanceId: "canvas-ontology-main",
          title: "Canvas surface ontology",
          url: "http://127.0.0.1:52922/",
        },
      });
      state = applySessionEvent(state, {
        type: "canvas_opened",
        canvas: {
          extensionId: "session:canvas-ontology",
          extensionName: "canvas-ontology",
          canvasId: "canvas-ontology",
          instanceId: "session-canvas-ontology-canvas-ontology",
          title: "Canvas surface ontology",
          url: "http://127.0.0.1:58480/",
        },
      });

      expect(state.canvases).toEqual([
        {
          key: JSON.stringify([
            "session:canvas-ontology",
            "canvas-ontology",
            "canvas-ontology-main",
          ]),
          extensionId: "session:canvas-ontology",
          extensionName: "canvas-ontology",
          canvasId: "canvas-ontology",
          instanceId: "canvas-ontology-main",
          title: "Canvas surface ontology",
          url: "http://127.0.0.1:52922/",
          revision: 1,
        },
        {
          key: JSON.stringify([
            "session:canvas-ontology",
            "canvas-ontology",
            "session-canvas-ontology-canvas-ontology",
          ]),
          extensionId: "session:canvas-ontology",
          extensionName: "canvas-ontology",
          canvasId: "canvas-ontology",
          instanceId: "session-canvas-ontology-canvas-ontology",
          title: "Canvas surface ontology",
          url: "http://127.0.0.1:58480/",
          revision: 1,
        },
      ]);
    });
  });

  describe("identity", () => {
    test("returns a new state while preserving unchanged branches", () => {
      const state = createInitialSession({
        messages: [{ role: "user", content: "hello" }],
        queuedMessages: [{ id: "queued-1", role: "user", content: "next" }],
      });
      const next = applySessionEvent(state, { type: "status", status: "thinking" });

      expect(next).not.toBe(state);
      expect(next.messages).toBe(state.messages);
      expect(next.queuedMessages).toBe(state.queuedMessages);
      expect(next.pendingToolCalls).toBe(state.pendingToolCalls);
      expect(next.status).toBe("thinking");
      expect(state.status).toBe("idle");
    });

    test("changes only the active row across 50 sequential tool calls", () => {
      let state = createInitialSession();

      for (let index = 1; index <= 50; index++) {
        const beforeStart = state.messages;
        state = applySessionEvent(state, {
          type: "tool_start",
          toolCallId: `bash-${index}`,
          toolName: "bash",
          arguments: { command: `echo ${index}` },
        });

        expectMessageIdentities(beforeStart, state.messages, Math.max(0, beforeStart.length - 1));
        if (beforeStart.length > 0) {
          expect(state.messages.at(-1)).not.toBe(beforeStart.at(-1));
        }

        const beforeCompletion = state.messages;
        state = applySessionEvent(state, {
          type: "tool_end",
          toolCallId: `bash-${index}`,
          success: true,
          result: String(index),
        });

        expectMessageIdentities(beforeCompletion, state.messages, beforeCompletion.length - 1);
        expect(state.messages.at(-1)).not.toBe(beforeCompletion.at(-1));

        const beforeDelta = state.messages;
        state = applySessionEvent(state, { type: "delta", content: `Finished ${index}.` });

        expectMessageIdentities(beforeDelta, state.messages);
        expect(state.messages).toHaveLength(beforeDelta.length + 1);
      }
    });
  });
});

describe("toSessionSnapshot", () => {
  test("maps live session state into the detail query snapshot shape", () => {
    const state = createInitialSession({
      messages: [{ role: "user", content: "hello" }],
      queuedMessages: [{ id: "q1", role: "user", content: "next" }],
      todos: [{ id: "t1", title: "todo", status: "pending" }],
      linkedSessionIds: ["linked-1"],
      artifacts: ["report.md"],
      status: "responding",
      reasoningContent: "thinking...",
      model: { name: "gpt-5.5" },
    });
    state.lastSeenEventId = 42;

    expect(toSessionSnapshot("session-1", state)).toEqual({
      id: "session-1",
      messages: state.messages,
      queuedMessages: state.queuedMessages,
      model: { name: "gpt-5.5" },
      todos: state.todos,
      linkedSessionIds: ["linked-1"],
      artifacts: ["report.md"],
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
      model: { name: "claude-opus-4.8" },
    });

    expect(snapshot.id).toBe("session-existing");
    expect(snapshot.model).toEqual({ name: "claude-opus-4.8" });
    // Empty linked sessions collapse to undefined rather than [].
    expect(snapshot.linkedSessionIds).toBeUndefined();
  });
});

describe("sessionSeedFromSnapshot", () => {
  /** An idle session with every snapshot-visible field populated, as the
   *  snapshot cached at clean close would produce it. */
  function richIdleSession() {
    const events: SessionEvent[] = [
      { type: "user_message", content: "summarize the repo" },
      { type: "status", status: "thinking" },
      {
        type: "tool_start",
        toolCallId: "t1",
        toolName: "read_file",
        arguments: { path: "README.md" },
      },
      { type: "tool_end", toolCallId: "t1", success: true, result: "read it" },
      { type: "delta", content: "Here is the summary." },
      {
        type: "todos_patch",
        patches: [{ type: "upsert", id: "1", title: "Ship it", status: "done" }],
      },
      {
        type: "artifacts_patch",
        patches: [{ type: "upsert", path: "summary.md" }],
      },
      { type: "linked_session_added", sessionId: "toy-box-child" },
      { type: "model_changed", model: { name: "gpt-5" } },
      { type: "end", reason: "idle" },
    ];

    return reduceEvents(events);
  }

  test("a seeded session round-trips to the same snapshot, minus per-stream fields", () => {
    const original = toSessionSnapshot("session-seed", richIdleSession());

    const seeded = createInitialSession(sessionSeedFromSnapshot(original));
    const roundTripped = toSessionSnapshot("session-seed", seeded);

    expect(roundTripped).toEqual({ ...original, lastSeenEventId: undefined });
    expect(seeded.pendingToolCalls.size).toBe(0);
  });

  // Individual messages intentionally share structure with the snapshot
  // (the client seeds its reducer from cached snapshots the same way); the
  // collections themselves must be copied so new turns never grow a cached
  // snapshot behind its readers.
  test("new turns grow the seeded session's collections, not the snapshot's", () => {
    const snapshot = toSessionSnapshot("session-clone", richIdleSession());

    const seeded = createInitialSession(sessionSeedFromSnapshot(snapshot));
    const originalMessageCount = snapshot.messages.length;
    seeded.messages.push({ role: "user", content: "a new turn" });
    (seeded.todos ?? []).push({ id: "2", title: "Injected", status: "pending" });
    seeded.artifacts.push("/tmp/state/other.md");

    expect(snapshot.messages).toHaveLength(originalMessageCount);
    expect(snapshot.todos).toHaveLength(1);
    expect(snapshot.artifacts).toEqual(["summary.md"]);
  });
});
