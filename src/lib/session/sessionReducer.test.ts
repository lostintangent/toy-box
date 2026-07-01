import { describe, expect, test } from "bun:test";
import {
  applySessionEvent,
  applyStreamError,
  createInitialSession,
  prepareSessionForNextTurn,
  sessionSeedFromSnapshot,
  toSessionSnapshot,
} from "./sessionReducer";
import type { AssistantMessage, SessionEvent } from "@/types";

describe("sessionReducer", () => {
  describe("messages", () => {
    test("replays a streamed turn with tool calls into interleaved assistant messages", () => {
      const state = createInitialSession();
      for (const event of [
        { type: "user_message", content: "hello" },
        { type: "status", status: "thinking" },
        {
          type: "tool_start",
          toolCallId: "t1",
          toolName: "read_file",
          arguments: { path: "docs/design.md" },
        },
        { type: "tool_end", toolCallId: "t1", success: true, result: "ok" },
        { type: "delta", content: "Done." },
        { type: "end", reason: "idle" },
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

    test("committed assistant messages append after thinking status", () => {
      const state = createInitialSession();
      applySessionEvent(state, { type: "user_message", content: "go" });
      applySessionEvent(state, { type: "status", status: "thinking" });
      applySessionEvent(state, { type: "assistant_message", content: "Done." });

      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]).toMatchObject({ role: "assistant", content: "Done." });
      expect(state.status).toBe("responding");
    });

    test("agent notifications create visible turn boundaries", () => {
      const state = createInitialSession();
      const notification = { type: "artifact_edited", path: "/tmp/plan.md" } as const;

      applySessionEvent(state, { type: "agent_notification", notification });
      applySessionEvent(state, { type: "status", status: "thinking" });
      applySessionEvent(state, { type: "assistant_message", content: "I reviewed the edit." });

      applySessionEvent(state, { type: "agent_notification", notification });
      applySessionEvent(state, { type: "status", status: "thinking" });
      applySessionEvent(state, { type: "assistant_message", content: "I reviewed the update." });

      expect(state.messages).toEqual([
        { role: "agent_notification", notification, timestamp: undefined },
        { role: "assistant", content: "I reviewed the edit." },
        { role: "agent_notification", notification, timestamp: undefined },
        { role: "assistant", content: "I reviewed the update." },
      ]);
      expect(state.status).toBe("responding");
    });

    test("committed assistant messages reconcile streamed assistant text", () => {
      const state = createInitialSession();
      applySessionEvent(state, { type: "user_message", content: "go" });
      applySessionEvent(state, { type: "status", status: "thinking" });
      applySessionEvent(state, { type: "delta", content: "Done" });
      applySessionEvent(state, { type: "delta", content: "Done." });
      applySessionEvent(state, { type: "assistant_message", content: "Done." });

      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]).toMatchObject({ role: "assistant", content: "Done." });
      expect(state.status).toBe("responding");
    });

    test("committed assistant messages reconcile after reasoning without a text delta", () => {
      const state = createInitialSession();
      applySessionEvent(state, { type: "user_message", content: "go" });
      applySessionEvent(state, { type: "status", status: "thinking" });
      applySessionEvent(state, { type: "reasoning", content: "Thinking..." });
      applySessionEvent(state, { type: "assistant_message", content: "Done." });

      expect(state.messages).toHaveLength(2);
      expect(state.messages[1]).toMatchObject({ role: "assistant", content: "Done." });
      expect(state.status).toBe("responding");
      expect(state.reasoningContent).toBe("");
    });
  });

  describe("streaming content", () => {
    test("status updates do not create assistant messages", () => {
      const state = createInitialSession();
      applySessionEvent(state, { type: "user_message", content: "go" });

      applySessionEvent(state, { type: "status", status: "thinking" });

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
      const state = createInitialSession();
      applySessionEvent(state, { type: "user_message", content: "go" });
      applySessionEvent(state, { type: "status", status: "thinking" });

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
      applySessionEvent(state, { type: "status", status: "thinking" });

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
      applySessionEvent(state, { type: "status", status: "thinking" });
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
      applySessionEvent(state, { type: "status", status: "thinking" });
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
      applySessionEvent(state, { type: "status", status: "thinking" });
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
      applySessionEvent(state, { type: "status", status: "thinking" });
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
      applySessionEvent(state, { type: "status", status: "thinking" });
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
      applySessionEvent(state, { type: "status", status: "thinking" });

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

  describe("canvases", () => {
    test("stores opened canvases and bumps revision when a canvas reopens", () => {
      const state = createInitialSession();

      applySessionEvent(state, {
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
      applySessionEvent(state, {
        type: "canvas_opened",
        canvas: {
          extensionId: "user:documint",
          canvasId: "documint-markdown-agent",
          instanceId: "review-plan",
          title: "Review Plan",
          url: "http://127.0.0.1:53950/?instanceId=review-plan",
          availability: "ready",
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
          availability: "ready",
          revision: 2,
        },
      ]);
      expect(toSessionSnapshot("session-1", state).canvases).toEqual(state.canvases);
    });

    test("reopen replaces a single matching canvas even when the instance id changes", () => {
      const state = createInitialSession();

      applySessionEvent(state, {
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
      applySessionEvent(state, {
        type: "canvas_opened",
        canvas: {
          extensionId: "session:canvas-ontology",
          extensionName: "canvas-ontology",
          canvasId: "canvas-ontology",
          instanceId: "session-canvas-ontology-canvas-ontology",
          title: "Canvas surface ontology",
          url: "http://127.0.0.1:58480/",
          reopen: true,
        },
      });

      expect(state.canvases).toEqual([
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
          reopen: true,
          revision: 2,
        },
      ]);
    });

    test("reopen with a changed instance id does not replace ambiguous matching canvases", () => {
      const state = createInitialSession();

      for (const instanceId of ["first", "second"]) {
        applySessionEvent(state, {
          type: "canvas_opened",
          canvas: {
            extensionId: "session:canvas-ontology",
            canvasId: "canvas-ontology",
            instanceId,
            title: `Canvas ${instanceId}`,
            url: `http://127.0.0.1/${instanceId}`,
          },
        });
      }

      applySessionEvent(state, {
        type: "canvas_opened",
        canvas: {
          extensionId: "session:canvas-ontology",
          canvasId: "canvas-ontology",
          instanceId: "third",
          title: "Canvas third",
          url: "http://127.0.0.1/third",
          reopen: true,
        },
      });

      expect(state.canvases).toHaveLength(3);
      expect(state.canvases?.map((canvas) => canvas.instanceId)).toEqual([
        "first",
        "second",
        "third",
      ]);
      expect(state.canvases?.map((canvas) => canvas.revision)).toEqual([1, 1, 1]);
    });
  });

  describe("artifacts", () => {
    test("appends artifact paths and includes them in snapshots", () => {
      const state = createInitialSession();

      applySessionEvent(state, {
        type: "artifacts_patch",
        patches: [{ type: "upsert", path: "~/.copilot/session-state/toy-box-session/report.md" }],
      });
      applySessionEvent(state, {
        type: "artifacts_patch",
        patches: [{ type: "upsert", path: "~/.copilot/session-state/toy-box-session/report.md" }],
      });
      applySessionEvent(state, {
        type: "artifacts_patch",
        patches: [{ type: "upsert", path: "~/.copilot/session-state/toy-box-session/notes.md" }],
      });

      expect(state.artifacts).toEqual([
        "~/.copilot/session-state/toy-box-session/report.md",
        "~/.copilot/session-state/toy-box-session/notes.md",
      ]);
      expect(toSessionSnapshot("session-1", state).artifacts).toEqual(state.artifacts);
    });

    test("removes deleted artifact paths", () => {
      const state = createInitialSession({
        artifacts: [
          "~/.copilot/session-state/toy-box-session/report.md",
          "~/.copilot/session-state/toy-box-session/notes.md",
        ],
      });

      applySessionEvent(state, {
        type: "artifacts_patch",
        patches: [{ type: "delete", path: "~/.copilot/session-state/toy-box-session/report.md" }],
      });

      expect(state.artifacts).toEqual(["~/.copilot/session-state/toy-box-session/notes.md"]);
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
        message: { id: "q1", role: "user", content: "first queued" },
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

    test("dequeues notification messages as visible agent notifications", () => {
      const notification = { type: "artifact_edited", path: "/tmp/plan.md" } as const;
      const withQueue = createInitialSession({
        queuedMessages: [{ id: "q1", role: "agent_notification", notification }],
        messages: [{ role: "assistant", content: "ready" }],
      });

      const state = applySessionEvent(withQueue, {
        type: "message_dequeued",
        message: { id: "q1", role: "agent_notification", notification },
      });

      expect(state.messages).toEqual([
        { role: "assistant", content: "ready" },
        { role: "agent_notification", notification },
      ]);
      expect(state.queuedMessages).toEqual([]);
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
        message: { id: "q2", role: "user", content: "second queued" },
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
        message: { id: "q1", role: "user", content: "follow up" },
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
        message: { id: "q1", role: "user", content: "follow up" },
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
      const state = createInitialSession();
      applySessionEvent(state, { type: "session_title_changed", title: "Friendly title" });
      expect(state.summary).toBe("Friendly title");
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

    test("drops id-less SDK user echoes with the turn-start echo guard", () => {
      const state = createInitialSession();

      applySessionEvent(state, {
        type: "user_message",
        content: "hello",
        clientMessageId: "msg-1",
      });
      applySessionEvent(state, { type: "status", status: "thinking" });

      applySessionEvent(state, {
        type: "user_message",
        content: "hello",
        timestamp: "2026-02-09T00:00:00.000Z",
        eventId: 10,
        turnId: "turn-1",
      });

      expect(state.messages).toEqual([{ role: "user", content: "hello" }]);
      expect(state.status).toBe("thinking");
      expect(state.pendingOptimisticUserMessage).toEqual({ clientMessageId: "msg-1", index: 0 });
      expect(state.lastSeenEventId).toBe(10);
    });

    test("reconciles decorated server user echoes after local thinking starts", () => {
      const state = createInitialSession();

      applySessionEvent(state, {
        type: "user_message",
        content: "hello",
        clientMessageId: "msg-1",
      });
      applySessionEvent(state, { type: "status", status: "thinking" });

      applySessionEvent(state, {
        type: "user_message",
        content: "hello",
        clientMessageId: "msg-1",
        timestamp: "2026-02-09T00:00:00.000Z",
        eventId: 10,
        turnId: "turn-1",
      });

      expect(state.messages).toEqual([
        {
          role: "user",
          content: "hello",
          timestamp: "2026-02-09T00:00:00.000Z",
          attachments: undefined,
        },
      ]);
      expect(state.status).toBe("thinking");
      expect(state.pendingOptimisticUserMessage).toBeUndefined();
    });

    test("drops SDK user echo after the decorated server echo already reconciled", () => {
      const state = createInitialSession();

      applySessionEvent(state, {
        type: "user_message",
        content: "hello",
        clientMessageId: "msg-1",
      });
      applySessionEvent(state, { type: "status", status: "thinking" });
      applySessionEvent(state, {
        type: "user_message",
        content: "hello",
        clientMessageId: "msg-1",
        eventId: 10,
        turnId: "turn-1",
      });
      applySessionEvent(state, {
        type: "user_message",
        content: "hello",
        timestamp: "2026-02-09T00:00:00.000Z",
        eventId: 11,
        turnId: "turn-1",
      });

      expect(state.messages).toEqual([
        {
          role: "user",
          content: "hello",
          timestamp: undefined,
          attachments: undefined,
        },
      ]);
      expect(state.status).toBe("thinking");
      expect(state.pendingOptimisticUserMessage).toBeUndefined();
    });

    test("does not dedupe a dequeued message for a new active turn", () => {
      const state = createInitialSession();
      applySessionEvent(state, {
        type: "user_message",
        content: "hello",
        eventId: 1,
        turnId: "turn-1",
      });
      applySessionEvent(state, { type: "assistant_message", content: "hi", eventId: 2 });
      applySessionEvent(state, {
        type: "message_dequeued",
        message: { id: "queued-1", role: "user", content: "hello" },
        eventId: 3,
        turnId: "turn-2",
      });

      expect(state.messages).toEqual([
        { role: "user", content: "hello", attachments: undefined, timestamp: undefined },
        { role: "assistant", content: "hi", toolCalls: undefined },
        { role: "user", content: "hello" },
      ]);
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
      applySessionEvent(state, { type: "status", status: "thinking" });
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
      const sameRef = applySessionEvent(state, { type: "status", status: "thinking" });
      expect(sameRef).toBe(state);
      expect(state.status).toBe("thinking");
    });
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
      { type: "artifacts_patch", patches: [{ type: "upsert", path: "/tmp/state/summary.md" }] },
      { type: "linked_session_added", sessionId: "toy-box-child" },
      { type: "model_changed", modelConfiguration: { model: "gpt-5" } },
      { type: "end", reason: "idle" },
    ];

    const state = createInitialSession();
    for (const event of events) {
      applySessionEvent(state, event);
    }
    return state;
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
    expect(snapshot.artifacts).toEqual(["/tmp/state/summary.md"]);
  });
});
