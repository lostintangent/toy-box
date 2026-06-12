import { describe, expect, test } from "bun:test";
import {
  applySessionEvent,
  applyStreamError,
  createInitialSession,
  prepareSessionForNextTurn,
} from "./sessionReducer";
import type { AssistantMessage } from "@/types";

describe("sessionReducer", () => {
  describe("messages", () => {
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
        id: "t1",
        name: "read_file",
        result: {
          content: "ok",
          success: true,
        },
      });
      // Second assistant message: text after tool calls
      expect(state.messages[2]).toMatchObject({ role: "assistant", content: "Done." });
      expect((state.messages[2] as AssistantMessage).toolCalls).toBeUndefined();
      expect(state.status).toBe("idle");
    });

    test("committed assistant messages produce separate messages and finalize pending tool calls", () => {
      // Replay interleaving: a committed message's tools attach via the
      // pending map, and the next committed message is a turn boundary that
      // must not drag the previous group's tool calls along.
      const state = createInitialSession();
      for (const event of [
        { type: "assistant_message" as const, content: "First" },
        {
          type: "tool_start" as const,
          toolCallId: "t1",
          toolName: "glob",
          arguments: { pattern: "*.ts" },
        },
        { type: "tool_end" as const, toolCallId: "t1", success: true, result: "ok" },
        { type: "assistant_message" as const, content: "Second" },
      ]) {
        applySessionEvent(state, event);
      }

      expect(state.messages).toHaveLength(2);
      expect(state.messages[0]).toMatchObject({
        role: "assistant",
        content: "First",
      });
      expect((state.messages[0] as AssistantMessage).toolCalls).toHaveLength(1);
      expect((state.messages[0] as AssistantMessage).toolCalls?.[0]).toMatchObject({
        id: "t1",
        name: "glob",
        result: { content: "ok", success: true },
      });
      expect(state.messages[1]).toMatchObject({
        role: "assistant",
        content: "Second",
      });
      expect((state.messages[1] as AssistantMessage).toolCalls).toBeUndefined();
      expect(state.pendingToolCalls.size).toBe(0);
    });
  });

  describe("streaming content", () => {
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

    test("routes scoped reasoning chunks into the matching agent tool call", () => {
      const state = createInitialSession();
      applySessionEvent(state, { type: "thinking" });
      applySessionEvent(state, {
        type: "tool_start",
        toolCallId: "agent-1",
        toolName: "agent",
        arguments: { agent_type: "explore" },
      });

      applySessionEvent(state, {
        type: "reasoning",
        agentId: "agent-1",
        content: "Inspecting",
      });
      applySessionEvent(state, {
        type: "reasoning",
        agentId: "agent-1",
        content: "Inspecting files",
      });

      const message = state.messages[0] as AssistantMessage;
      expect(message.toolCalls?.[0].agent?.reasoningContent).toBe("Inspecting files");
      expect(state.reasoningContent).toBe("");
      expect(state.status).toBe("thinking");
    });

    test("accumulates scoped assistant messages on the matching agent tool call", () => {
      const state = createInitialSession();
      applySessionEvent(state, { type: "thinking" });
      applySessionEvent(state, {
        type: "tool_start",
        toolCallId: "agent-1",
        toolName: "agent",
        arguments: { agent_type: "explore" },
      });

      applySessionEvent(state, {
        type: "assistant_message",
        agentId: "agent-1",
        content: "Reading files",
      });
      applySessionEvent(state, {
        type: "assistant_message",
        agentId: "agent-1",
        content: "Summarizing findings",
      });

      const message = state.messages[0] as AssistantMessage;
      expect(message.toolCalls?.[0].agent?.content).toBe("Reading files\n\nSummarizing findings");
      expect(state.messages).toHaveLength(1);
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
      expect((state.messages[1] as AssistantMessage).toolCalls?.[0]).toMatchObject({
        result: {
          content: "applied",
          success: true,
        },
      });
    });
  });

  describe("tool calls", () => {
    test("stores tool result details on completed tool calls", () => {
      const state = createInitialSession();

      applySessionEvent(state, {
        type: "tool_start",
        toolCallId: "patch-1",
        toolName: "patch",
        arguments: { patch: "*** Begin Patch\n*** End Patch" },
      });
      applySessionEvent(state, {
        type: "tool_end",
        toolCallId: "patch-1",
        success: true,
        result: "Modified 1 file(s)",
        details: "diff --git a/file b/file",
      });

      const message = state.messages[0] as AssistantMessage;
      expect(message.toolCalls?.[0]).toMatchObject({
        result: {
          content: "Modified 1 file(s)",
          success: true,
          details: "diff --git a/file b/file",
        },
      });
    });

    test("nests subagent tool calls under their pending parent agent call", () => {
      const state = createInitialSession();
      applySessionEvent(state, { type: "thinking" });
      applySessionEvent(state, {
        type: "tool_start",
        toolCallId: "agent-1",
        toolName: "agent",
        arguments: { agentName: "explore" },
      });
      applySessionEvent(state, {
        type: "tool_start",
        toolCallId: "child-1",
        toolName: "read",
        arguments: { path: "a.ts" },
        agentId: "agent-1",
      });
      applySessionEvent(state, {
        type: "tool_end",
        toolCallId: "child-1",
        success: true,
        result: "contents",
        agentId: "agent-1",
      });
      applySessionEvent(state, {
        type: "tool_end",
        toolCallId: "agent-1",
        success: true,
        result: "Review complete",
      });

      const message = state.messages[0] as AssistantMessage;
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
      const state = createInitialSession();
      applySessionEvent(state, { type: "thinking" });
      applySessionEvent(state, {
        type: "tool_start",
        toolCallId: "agent-1",
        toolName: "agent",
        arguments: { agent_type: "explore" },
      });

      applySessionEvent(state, {
        type: "model_changed",
        agentId: "agent-1",
        modelConfiguration: { model: "claude-haiku-4.5" },
      });

      const message = state.messages[0] as AssistantMessage;
      expect(message.toolCalls?.[0].agent?.modelConfiguration).toEqual({
        model: "claude-haiku-4.5",
      });
      expect(state.modelConfiguration).toBeUndefined();
    });

    test("nests late subagent tool calls under a committed parent and bumps the message revision", () => {
      // Resume-mid-turn: the parent agent call arrived committed in a server
      // snapshot (initial state), then live child events arrive for it.
      const state = createInitialSession({
        messages: [
          {
            role: "assistant",
            content: "Kicking off review.",
            toolCalls: [{ id: "agent-1", name: "agent", arguments: { agentName: "explore" } }],
          },
        ],
      });
      const message = state.messages[0] as AssistantMessage;
      const initialRevision = message.revision ?? 0;

      applySessionEvent(state, {
        type: "tool_start",
        toolCallId: "child-1",
        toolName: "bash",
        arguments: { command: "ls" },
        agentId: "agent-1",
      });
      applySessionEvent(state, {
        type: "tool_end",
        toolCallId: "child-1",
        success: true,
        result: "ok",
        agentId: "agent-1",
      });

      // The committed parent's tool calls survive (no pending-map wipe)...
      expect(message.toolCalls).toHaveLength(1);
      expect(message.toolCalls?.[0].agent?.toolCalls).toHaveLength(1);
      expect(message.toolCalls?.[0].agent?.toolCalls?.[0]).toMatchObject({
        id: "child-1",
        result: { content: "ok", success: true },
      });
      // ...and the message revision was bumped so memoized renderers update.
      expect(message.revision ?? 0).toBeGreaterThan(initialRevision);
    });

    test("completes a committed root tool call after a message boundary (late background completion)", () => {
      // A background agent task is started, the assistant moves on (text
      // after the tool group commits the call and clears pending), and the
      // deferred completion (subagent.completed → tool_end) arrives later.
      const state = createInitialSession();
      applySessionEvent(state, { type: "delta", content: "Kicking off a background review." });
      applySessionEvent(state, {
        type: "tool_start",
        toolCallId: "task-1",
        toolName: "agent",
        arguments: { mode: "background" },
      });
      applySessionEvent(state, { type: "delta", content: "Continuing while it runs." });

      const committedMessage = state.messages[0] as AssistantMessage;
      const initialRevision = committedMessage.revision ?? 0;
      expect(state.pendingToolCalls.size).toBe(0);

      applySessionEvent(state, {
        type: "tool_end",
        toolCallId: "task-1",
        success: true,
      });

      // The result lands on the committed call, and the revision bump tells
      // memoized renderers to update.
      expect(committedMessage.toolCalls?.[0]).toMatchObject({
        id: "task-1",
        result: { content: "", success: true },
      });
      expect(committedMessage.revision ?? 0).toBeGreaterThan(initialRevision);
    });

    test("ignores child tool events whose parent is unknown", () => {
      const state = createInitialSession();
      applySessionEvent(state, { type: "thinking" });

      applySessionEvent(state, {
        type: "tool_start",
        toolCallId: "child-x",
        toolName: "bash",
        arguments: {},
        agentId: "missing-parent",
      });
      applySessionEvent(state, {
        type: "tool_end",
        toolCallId: "child-x",
        success: true,
        result: "ok",
        agentId: "missing-parent",
      });

      expect((state.messages[0] as AssistantMessage).toolCalls).toBeUndefined();
    });
  });

  describe("queued messages", () => {
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
  });

  describe("todos & metadata", () => {
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
      expect(state.reasoningContent).toBe("");
      expect(state.pendingToolCalls.size).toBe(0);
    });

    test("stores session title updates from metadata events", () => {
      const state = createInitialSession();
      applySessionEvent(state, { type: "session_title_changed", title: "Friendly title" });
      expect(state.summary).toBe("Friendly title");
    });
  });

  describe("event replay & dedup", () => {
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

    test("skips replayed events that are older than the current snapshot", () => {
      const state = createInitialSession({
        messages: [{ role: "user", content: "already synced" }],
      });
      state.lastSeenEventId = 20;

      applySessionEvent(state, {
        type: "user_message",
        content: "already synced",
        eventId: 20,
      });
      applySessionEvent(state, {
        type: "assistant_message",
        content: "stale response",
        eventId: 19,
      });

      expect(state.messages).toEqual([{ role: "user", content: "already synced" }]);
      expect(state.lastSeenEventId).toBe(20);
    });

    test("keeps optimistic local events and newer stream events after stale-event filtering", () => {
      const state = createInitialSession();
      state.lastSeenEventId = 20;

      applySessionEvent(state, {
        type: "user_message",
        content: "optimistic",
        clientMessageId: "client-1",
      });
      applySessionEvent(state, {
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
        modelConfiguration: { model: "claude-sonnet-4.6" },
      });
      previousState.pendingToolCalls.set("tool-1", {
        id: "tool-1",
        name: "open_session",
        arguments: { sessionId: "session-1" },
      });

      const nextState = prepareSessionForNextTurn(previousState);

      expect(nextState).toBe(previousState);
      expect(nextState.messages).toEqual([
        { role: "user", content: "Open the ocean session" },
        { role: "assistant", content: "Done." },
      ]);
      expect(nextState.todos).toEqual([
        { id: "todo-1", title: "Inspect stream state", status: "in_progress" },
      ]);
      expect(nextState.linkedSessionIds).toEqual(["session-1", "session-2"]);
      expect(nextState.modelConfiguration).toEqual({ model: "claude-sonnet-4.6" });
      expect(nextState.queuedMessages).toEqual([
        { id: "queued-1", role: "user", content: "Now summarize it" },
      ]);

      expect(nextState.reasoningContent).toBe("");
      expect(nextState.status).toBe("thinking");
      expect(nextState.pendingToolCalls.size).toBe(0);
      expect(nextState.pendingOptimisticUserMessage).toBeUndefined();
    });

    test("applyStreamError replaces a partial assistant message with the error notice", () => {
      const state = createInitialSession();
      applySessionEvent(state, { type: "user_message", content: "go" });
      applySessionEvent(state, { type: "thinking" });
      applySessionEvent(state, { type: "delta", content: "partial resp" });

      applyStreamError(state, "Something broke.");

      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]).toMatchObject({ role: "assistant", content: "Something broke." });
      expect(state.status).toBe("idle");
      expect(state.reasoningContent).toBe("");
      expect(state.pendingToolCalls.size).toBe(0);
    });

    test("applyStreamError appends an assistant message when none is trailing", () => {
      const state = createInitialSession();
      applySessionEvent(state, { type: "user_message", content: "go" });

      applyStreamError(state, "Something broke.");

      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]).toMatchObject({ role: "assistant", content: "Something broke." });
      expect(state.status).toBe("idle");
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

    test("unhandled events do not change status", () => {
      let state = createInitialSession();
      const initialStatus = state.status;

      state = applySessionEvent(state, { type: "skills", skills: [] });
      expect(state.status).toEqual(initialStatus);

      state = applySessionEvent(state, {
        type: "tool_start",
        toolCallId: "tc-2",
        toolName: "search",
        arguments: { query: "tanstack" },
      });
      expect(state.status).toEqual(initialStatus);
    });

    test("mutates state in-place", () => {
      const state = createInitialSession();
      const sameRef = applySessionEvent(state, { type: "thinking" });
      expect(sameRef).toBe(state);
      expect(state.status).toBe("thinking");
    });
  });
});
