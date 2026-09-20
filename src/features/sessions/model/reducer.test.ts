import { describe, expect, test } from "bun:test";
import { applySessionEvent, createInitialSessionState, replaySessionHistory } from "./reducer";
import type { AssistantMessage, SessionEvent, SessionQuestionBase, SessionState } from "./index";

function reduceEvents(
  events: readonly SessionEvent[],
  initial = createInitialSessionState(),
): SessionState {
  return events.reduce(applySessionEvent, initial);
}

function assistantAt(state: SessionState, index: number): AssistantMessage {
  const message = state.messages[index];
  if (message?.role !== "assistant") {
    throw new Error(`Expected assistant message at index ${index}`);
  }
  return message;
}

function requestQuestion(toolCallId: string, question: SessionQuestionBase): SessionEvent[] {
  return [
    {
      type: "tool_start",
      toolCallId,
      toolName: "ask_user",
      arguments: {},
      question,
    },
    {
      type: "question_requested",
      toolCallId,
      requestId: `request-${toolCallId}`,
      question,
    },
  ];
}

describe("session reducer", () => {
  test("creates one normalized state shape", () => {
    const messages = [{ role: "user" as const, content: "hello" }];
    const state = createInitialSessionState({ messages, lastSeenEventId: 4 });

    expect(state).toEqual({
      messages,
      queuedMessages: [],
      todos: [],
      linkedSessionIds: [],
      canvases: [],
      artifacts: [],
      openedFiles: [],
      status: "idle",
      reasoningContent: "",
      model: undefined,
      lastSeenEventId: 4,
    });
    expect(state.messages).not.toBe(messages);
  });

  describe("messages and streaming", () => {
    test("keeps text and tool groups in transcript order", () => {
      const state = reduceEvents([
        { type: "user_message", content: "hello" },
        { type: "status", status: "thinking" },
        {
          type: "tool_start",
          toolCallId: "read-1",
          toolName: "read",
          arguments: { path: "README.md" },
        },
        {
          type: "tool_end",
          toolCallId: "read-1",
          success: true,
          result: "contents",
          details: "read README.md",
        },
        { type: "delta", content: "Done." },
        { type: "end", reason: "idle" },
      ]);

      expect(state.messages).toEqual([
        {
          role: "user",
          content: "hello",
          attachments: undefined,
          timestamp: undefined,
        },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "read-1",
              name: "read",
              arguments: { path: "README.md" },
              result: { content: "contents", success: true, details: "read README.md" },
            },
          ],
        },
        { role: "assistant", content: "Done." },
      ]);
      expect(state.status).toBe("idle");
    });

    test("committed messages close a tool group without carrying its tools forward", () => {
      const state = reduceEvents([
        { type: "assistant_message", content: "First" },
        {
          type: "tool_start",
          toolCallId: "glob-1",
          toolName: "glob",
          arguments: { pattern: "*.ts" },
        },
        { type: "tool_end", toolCallId: "glob-1", success: true, result: "a.ts" },
        { type: "assistant_message", content: "Second" },
      ]);

      expect(assistantAt(state, 0)).toMatchObject({
        content: "First",
        toolCalls: [{ id: "glob-1", result: { content: "a.ts", success: true } }],
      });
      expect(assistantAt(state, 1)).toEqual({ role: "assistant", content: "Second" });
    });

    test.each([undefined, "message-1"])(
      "a committed message replaces its streamed preview, including shorter text (ID: %s)",
      (messageId) => {
        const state = reduceEvents([
          { type: "status", status: "thinking" },
          { type: "delta", messageId, content: "Final answer draft" },
          { type: "assistant_message", messageId, content: "Final answer" },
        ]);

        expect(state.messages).toEqual([
          { role: "assistant", ...(messageId ? { messageId } : {}), content: "Final answer" },
        ]);
        expect(state.status).toBe("responding");
      },
    );

    test("different native message IDs preserve separate assistant messages", () => {
      const state = reduceEvents([
        { type: "delta", messageId: "message-1", content: "First" },
        { type: "assistant_message", messageId: "message-2", content: "Second" },
      ]);

      expect(state.messages.map((message) => message.content)).toEqual(["First", "Second"]);
    });

    test.each([
      { chunks: ["ha", "ha"], expected: "haha" },
      { chunks: ["ab", "abc"], expected: "ababc" },
      { chunks: ["cof", "fee"], expected: "coffee" },
    ])("appends text chunks verbatim: $expected", ({ chunks, expected }) => {
      const state = reduceEvents(chunks.map((content) => ({ type: "delta", content })));
      expect(assistantAt(state, 0).content).toBe(expected);
    });

    test.each([undefined, "agent-1"])(
      "reasoning deltas append and complete reasoning replaces them (parent: %s)",
      (parentToolCallId) => {
        const initial = parentToolCallId
          ? reduceEvents([
              {
                type: "tool_start",
                toolCallId: parentToolCallId,
                toolName: "agent",
                arguments: {},
              },
            ])
          : createInitialSessionState();
        const reasoning = (state: SessionState) =>
          parentToolCallId
            ? assistantAt(state, 0).toolCalls?.[0]?.subagent?.reasoningContent
            : state.reasoningContent;
        const streaming = reduceEvents(
          [
            { type: "reasoning_delta", content: "ha", parentToolCallId },
            { type: "reasoning_delta", content: "ha", parentToolCallId },
          ],
          initial,
        );
        expect(reasoning(streaming)).toBe("haha");
        const completed = applySessionEvent(streaming, {
          type: "reasoning",
          content: "ha",
          parentToolCallId,
        });
        expect(reasoning(completed)).toBe("ha");
        if (parentToolCallId) expect(completed.reasoningContent).toBe("");
      },
    );

    test("reasoning stays separate and clears when response text starts", () => {
      const state = reduceEvents([
        { type: "reasoning_delta", content: "Now I can" },
        { type: "reasoning", content: "Now I can see the pattern" },
        { type: "delta", content: "Answer" },
      ]);

      expect(state.reasoningContent).toBe("");
      expect(state.status).toBe("responding");
      expect(assistantAt(state, 0).content).toBe("Answer");
    });

    test("empty deltas do not create a boundary or lose a tool completion", () => {
      const state = reduceEvents([
        { type: "user_message", content: "go" },
        {
          type: "tool_start",
          toolCallId: "edit-1",
          toolName: "edit",
          arguments: { path: "file.ts" },
        },
        { type: "delta", content: "" },
        { type: "tool_end", toolCallId: "edit-1", success: true, result: "applied" },
      ]);

      expect(state.messages).toHaveLength(2);
      expect(assistantAt(state, 1).toolCalls?.[0]).toMatchObject({
        id: "edit-1",
        result: { content: "applied", success: true },
      });
    });

    test("system messages remain visible turn boundaries", () => {
      const content = {
        type: "file_edited",
        file: { kind: "session", sessionId: "session-1", path: "plan.md" },
      } as const;
      const state = reduceEvents([
        { type: "system_message", content },
        { type: "assistant_message", content: "Reviewed." },
        { type: "system_message", content },
      ]);

      expect(state.messages.map(({ role }) => role)).toEqual(["system", "assistant", "system"]);
    });
  });

  describe("tool calls and subagents", () => {
    test("routes subagent output, tools, and model to its parent tool call", () => {
      const state = reduceEvents([
        {
          type: "tool_start",
          toolCallId: "agent-1",
          toolName: "agent",
          arguments: { task: "review" },
        },
        { type: "reasoning", parentToolCallId: "agent-1", content: "Inspecting" },
        { type: "assistant_message", parentToolCallId: "agent-1", content: "Found one issue." },
        {
          type: "model_changed",
          parentToolCallId: "agent-1",
          model: { provider: "copilot", name: "claude-haiku-4.5" },
        },
        {
          type: "tool_start",
          parentToolCallId: "agent-1",
          toolCallId: "read-1",
          toolName: "read",
          arguments: { path: "a.ts" },
        },
        {
          type: "tool_end",
          parentToolCallId: "agent-1",
          toolCallId: "read-1",
          success: true,
          result: "contents",
        },
      ]);

      const parent = assistantAt(state, 0).toolCalls?.[0];
      expect(parent?.subagent).toEqual({
        reasoningContent: "Inspecting",
        content: "Found one issue.",
        model: { provider: "copilot", name: "claude-haiku-4.5" },
        toolCalls: [
          {
            id: "read-1",
            name: "read",
            arguments: { path: "a.ts" },
            result: { content: "contents", success: true, details: undefined },
          },
        ],
      });
      expect(state.model).toBeUndefined();
    });

    test("unknown subagent tool events do not create a root assistant message", () => {
      const state = reduceEvents([
        { type: "status", status: "thinking" },
        {
          type: "tool_start",
          parentToolCallId: "missing-parent",
          toolCallId: "child-1",
          toolName: "read",
          arguments: {},
        },
        {
          type: "tool_end",
          parentToolCallId: "missing-parent",
          toolCallId: "child-1",
          success: true,
        },
      ]);

      expect(state.messages).toEqual([]);
      expect(state.status).toBe("thinking");
    });

    test("late subagent events replace only the committed parent branch", () => {
      const initial = createInitialSessionState({
        messages: [
          {
            role: "assistant",
            content: "Delegating.",
            toolCalls: [{ id: "agent-1", name: "agent", arguments: {} }],
          },
          { role: "assistant", content: "Meanwhile." },
        ],
      });
      const parentMessage = initial.messages[0];
      const unaffectedMessage = initial.messages[1];

      const next = applySessionEvent(initial, {
        type: "tool_start",
        parentToolCallId: "agent-1",
        toolCallId: "child-1",
        toolName: "bash",
        arguments: { command: "ls" },
      });

      expect(next.messages[0]).not.toBe(parentMessage);
      expect(next.messages[1]).toBe(unaffectedMessage);
      expect(assistantAt(next, 0).toolCalls?.[0].subagent?.toolCalls?.[0].id).toBe("child-1");
    });

    test("late root completions update the original tool group after a boundary", () => {
      const beforeCompletion = reduceEvents([
        { type: "delta", content: "Starting a background review." },
        {
          type: "tool_start",
          toolCallId: "agent-1",
          toolName: "agent",
          arguments: { mode: "background" },
        },
        { type: "delta", content: "Continuing." },
      ]);
      const originalToolMessage = beforeCompletion.messages[0];
      const currentTextMessage = beforeCompletion.messages[1];

      const completed = applySessionEvent(beforeCompletion, {
        type: "tool_end",
        toolCallId: "agent-1",
        success: true,
      });

      expect(completed.messages[0]).not.toBe(originalToolMessage);
      expect(completed.messages[1]).toBe(currentTextMessage);
      expect(assistantAt(completed, 0).toolCalls?.[0].result).toEqual({
        content: "",
        success: true,
        details: undefined,
      });
    });
  });

  describe("questions", () => {
    test("moves a question through unanswered, pending, and answered states", () => {
      const question = {
        question: "Which database?",
        choices: ["SQLite", "PostgreSQL"],
        allowFreeform: true,
      };
      let state = reduceEvents([
        {
          type: "tool_start",
          toolCallId: "question-1",
          toolName: "ask_user",
          arguments: {},
          question,
        },
      ]);
      expect(assistantAt(state, 0).toolCalls?.[0].question).toEqual({
        ...question,
        state: "unanswered",
      });

      state = reduceEvents(
        [
          {
            type: "question_requested",
            toolCallId: "question-1",
            requestId: "request-1",
            question,
          },
        ],
        state,
      );
      expect(state.status).toBe("thinking");
      expect(assistantAt(state, 0).toolCalls?.[0].question).toEqual({
        ...question,
        state: "pending",
        requestId: "request-1",
      });

      state = applySessionEvent(state, {
        type: "question_resolved",
        toolCallId: "question-1",
        answer: "SQLite",
      });
      expect(state.status).toBe("thinking");
      expect(assistantAt(state, 0).toolCalls?.[0].question).toEqual({
        ...question,
        state: "answered",
        answer: "SQLite",
      });
    });

    test("nonblocking or unknown question events do not invent a status transition", () => {
      const nonblocking = { question: "Optional", allowFreeform: true, blocking: false };
      let state = reduceEvents([
        { type: "status", status: "reasoning" },
        ...requestQuestion("background", nonblocking),
      ]);
      expect(state.status).toBe("reasoning");

      state = applySessionEvent(state, {
        type: "question_requested",
        toolCallId: "missing",
        requestId: "missing",
        question: { question: "Missing?", allowFreeform: true },
      });
      expect(state.status).toBe("reasoning");
    });

    test("turn end makes pending questions read-only", () => {
      const question = { question: "Continue?", allowFreeform: true };
      const state = reduceEvents([
        {
          type: "message_queued",
          message: { clientId: "queued-1", role: "user", content: "Next" },
        },
        ...requestQuestion("question-1", question),
        { type: "end", reason: "idle" },
      ]);

      expect(state.status).toBe("idle");
      expect(state.queuedMessages).toEqual([]);
      expect(assistantAt(state, 0).toolCalls?.[0].question).toEqual({
        ...question,
        state: "unanswered",
      });
    });
  });

  describe("queued and optimistic inputs", () => {
    test("one client ID moves a queued user input into its canonical transcript entry", () => {
      const state = reduceEvents(
        [
          {
            type: "user_message",
            clientId: "message-2",
            content: "canonical second",
            timestamp: "2026-02-09T00:00:00.400Z",
          },
        ],
        createInitialSessionState({
          queuedMessages: [
            { clientId: "message-1", role: "user", content: "first", status: "queued" },
            { clientId: "message-2", role: "user", content: "second", status: "submitted" },
          ],
          messages: [{ role: "assistant", content: "ready" }],
        }),
      );

      expect(state.queuedMessages).toEqual([
        { clientId: "message-1", role: "user", content: "first", status: "queued" },
      ]);
      expect(state.messages.at(-1)).toEqual({
        role: "user",
        clientId: "message-2",
        content: "canonical second",
        attachments: undefined,
        timestamp: "2026-02-09T00:00:00.400Z",
      });
    });

    test("canonical echoes replace only their matching optimistic user message", () => {
      const state = reduceEvents([
        { type: "user_message", clientId: "message-1", content: "first optimistic" },
        { type: "user_message", clientId: "message-2", content: "second optimistic" },
        {
          type: "user_message",
          clientId: "message-2",
          content: "canonical second",
          eventId: 10,
        },
      ]);

      expect(state.messages).toEqual([
        {
          role: "user",
          clientId: "message-1",
          content: "first optimistic",
          attachments: undefined,
          timestamp: undefined,
        },
        {
          role: "user",
          clientId: "message-2",
          content: "canonical second",
          attachments: undefined,
          timestamp: undefined,
        },
      ]);
    });

    test("one queue entry advances through its explicit submission lifecycle", () => {
      const message = {
        clientId: "message-1",
        role: "user" as const,
        content: "next",
      };
      const state = reduceEvents([
        { type: "message_queued", message },
        { type: "message_queued", message: { ...message, immediate: true } },
        {
          type: "message_status_changed",
          clientId: "message-1",
          status: "submitting",
        },
        {
          type: "message_status_changed",
          clientId: "message-1",
          status: "submitted",
        },
      ]);

      expect(state.queuedMessages).toEqual([{ ...message, immediate: true, status: "submitted" }]);
    });

    test("canonical system inputs dequeue by the same client ID", () => {
      const content = {
        type: "file_edited",
        file: { kind: "session", sessionId: "session-1", path: "plan.md" },
      } as const;
      const state = reduceEvents(
        [{ type: "system_message", clientId: "system-1", content }],
        createInitialSessionState({
          queuedMessages: [
            { clientId: "system-1", role: "system", content, status: "submitted" },
            { clientId: "user-1", role: "user", content: "keep", status: "queued" },
          ],
        }),
      );

      expect(state.queuedMessages).toEqual([
        { clientId: "user-1", role: "user", content: "keep", status: "queued" },
      ]);
      expect(state.messages).toEqual([
        { role: "system", clientId: "system-1", content, timestamp: undefined },
      ]);
    });
  });

  describe("lifecycle and replay", () => {
    test("error completion annotates partial output without mutating prior state", () => {
      const before = reduceEvents([
        { type: "user_message", content: "go" },
        { type: "delta", content: "partial" },
        {
          type: "tool_start",
          toolCallId: "read-1",
          toolName: "read",
          arguments: {},
        },
      ]);
      const after = applySessionEvent(before, {
        type: "end",
        reason: "error",
        error: "Usage limit",
      });

      expect(assistantAt(after, 1)).toMatchObject({
        content: "partial",
        error: "Usage limit",
      });
      expect(assistantAt(before, 1).error).toBeUndefined();
      expect(after.status).toBe("idle");
    });

    test("a later turn never reuses a failed assistant message", () => {
      const failed = reduceEvents([
        { type: "user_message", content: "go" },
        { type: "end", reason: "error", error: "Usage limit" },
      ]);
      const retried = reduceEvents(
        [
          { type: "status", status: "thinking" },
          { type: "delta", content: "Recovered" },
        ],
        failed,
      );

      expect(retried.messages).toHaveLength(3);
      expect(retried.messages[1]).toBe(failed.messages[1]);
      expect(assistantAt(retried, 2)).toMatchObject({ content: "Recovered" });
      expect(assistantAt(retried, 2).error).toBeUndefined();
    });

    test("event cursors reject stale replay without rejecting local optimistic events", () => {
      let state = createInitialSessionState({
        messages: [{ role: "user", content: "already synced" }],
        lastSeenEventId: 20,
      });
      state = applySessionEvent(state, {
        type: "assistant_message",
        content: "stale",
        eventId: 19,
      });
      state = applySessionEvent(state, {
        type: "user_message",
        clientId: "local-1",
        content: "optimistic",
      });
      state = applySessionEvent(state, {
        type: "assistant_message",
        content: "new",
        eventId: 21,
      });

      expect(state.messages.map((message) => message.content)).toEqual([
        "already synced",
        "optimistic",
        "new",
      ]);
      expect(state.lastSeenEventId).toBe(21);
    });

    test("history replay always settles transient state to idle", () => {
      const state = replaySessionHistory([
        { type: "reasoning", content: "thinking" },
        { type: "delta", content: "answer" },
      ]);

      expect(state.status).toBe("idle");
      expect(state.reasoningContent).toBe("");
      expect(assistantAt(state, 0).content).toBe("answer");
    });
  });

  describe("session-owned resources", () => {
    test("applies the todo patch algebra with an empty array as the stable empty state", () => {
      let state = reduceEvents([
        {
          type: "todos_patch",
          patches: [
            {
              type: "replace_all",
              items: [
                { id: "one", title: "One", status: "pending" },
                { id: "two", title: "Two", status: "pending" },
              ],
            },
            { type: "update_all", status: "in_progress" },
            { type: "upsert", id: "one", title: "First", status: "done" },
            { type: "delete", id: "two" },
            { type: "upsert", id: "three", title: "Three" },
          ],
        },
      ]);

      expect(state.todos).toEqual([
        { id: "one", title: "First", status: "done" },
        { id: "three", title: "Three", status: "pending" },
      ]);

      state = applySessionEvent(state, {
        type: "todos_patch",
        patches: [
          { type: "delete", id: "one" },
          { type: "delete", id: "three" },
        ],
      });
      expect(state.todos).toEqual([]);
    });

    test("linked sessions and artifacts are idempotent ordered collections", () => {
      const state = reduceEvents([
        { type: "linked_session_added", sessionId: "child-1" },
        { type: "linked_session_added", sessionId: "child-1" },
        { type: "linked_session_added", sessionId: "child-2" },
        { type: "linked_session_removed", sessionId: "child-1" },
        { type: "artifacts_changed", artifacts: ["report.md", "notes.md"] },
        { type: "artifacts_changed", artifacts: [] },
      ]);

      expect(state.linkedSessionIds).toEqual(["child-2"]);
      expect(state.artifacts).toEqual([]);
    });

    test("canvas identity separates instances and bumps revisions in place", () => {
      const state = reduceEvents([
        {
          type: "canvas_opened",
          canvas: {
            extensionId: "user:docs",
            canvasId: "markdown",
            instanceId: "review",
            title: "Review",
            url: "http://localhost:1000",
          },
        },
        {
          type: "canvas_opened",
          canvas: {
            extensionId: "user:docs",
            canvasId: "markdown",
            instanceId: "review",
            title: "Review",
            url: "http://localhost:2000",
          },
        },
        {
          type: "canvas_opened",
          canvas: {
            extensionId: "user:docs",
            canvasId: "markdown",
            instanceId: "notes",
            title: "Notes",
            url: "http://localhost:3000",
          },
        },
      ]);

      expect(state.canvases).toHaveLength(2);
      expect(state.canvases[0]).toEqual({
        key: JSON.stringify(["user:docs", "markdown", "review"]),
        extensionId: "user:docs",
        canvasId: "markdown",
        instanceId: "review",
        title: "Review",
        url: "http://localhost:2000",
        revision: 2,
      });
      expect(state.canvases[1]).toMatchObject({ instanceId: "notes", revision: 1 });
    });

    test("opened files are unique by workspace identity and can be closed", () => {
      const file = { kind: "machine", path: "/repo/src/foo.ts" } as const;
      const state = reduceEvents([
        { type: "file_opened", file },
        { type: "file_opened", file },
        { type: "file_closed", file },
      ]);

      expect(state.openedFiles).toEqual([]);
    });

    test("session title events do not enter transcript state", () => {
      const state = applySessionEvent(createInitialSessionState(), {
        type: "session_title_changed",
        title: "Workspace-owned title",
      });

      expect(state).toEqual(createInitialSessionState());
      expect("title" in state).toBe(false);
    });
  });

  test("returns a new root while preserving unchanged branches", () => {
    const state = createInitialSessionState({
      messages: [{ role: "user", content: "hello" }],
      queuedMessages: [{ clientId: "queued-1", role: "user", content: "next", status: "queued" }],
    });
    const next = applySessionEvent(state, { type: "status", status: "thinking" });

    expect(next).not.toBe(state);
    expect(next.messages).toBe(state.messages);
    expect(next.queuedMessages).toBe(state.queuedMessages);
    expect(next.status).toBe("thinking");
    expect(state.status).toBe("idle");
  });
});
