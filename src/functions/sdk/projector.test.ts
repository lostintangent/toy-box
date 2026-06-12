import { describe, expect, test } from "bun:test";
import { createProjectionState, projectSdkEvent } from "@/functions/sdk/projector";
import type { SdkSessionEvent } from "@/functions/sdk/extractors";
import type { JsonValue, SessionEvent } from "@/types";

function createStreamingContext() {
  return createProjectionState();
}

// Every tool name from the projector's static omitted-tool policy.
const OMITTED_TOOL_NAMES = [
  "read_agent",
  "check_session_status",
  "wait_for_sessions",
  "send_to_session",
  "list_automations",
  "create_automation",
  "edit_automation",
  "run_automation",
];

// Shared apply_patch fixtures (the SDK sends the patch as a bare string).
const PATCH_TEXT = `*** Begin Patch
*** Update File: /Users/lostintangent/Desktop/toy-box/docs/notes.md
@@
-old
+new
*** End Patch`;
const PATCH_DIFF = `diff --git a/Users/lostintangent/Desktop/toy-box/docs/notes.md b/Users/lostintangent/Desktop/toy-box/docs/notes.md
--- a/Users/lostintangent/Desktop/toy-box/docs/notes.md
+++ b/Users/lostintangent/Desktop/toy-box/docs/notes.md
@@ -1 +1 @@
-old
+new`;

function modelChange(newModel: string, reasoningEffort?: string): SdkSessionEvent {
  return {
    type: "session.model_change",
    data: { newModel, ...(reasoningEffort ? { reasoningEffort } : {}) },
  };
}

function titleChanged(title: string): SdkSessionEvent {
  return {
    type: "session.title_changed",
    data: { title },
  };
}

function toolExecutionStart(
  toolName: string,
  toolCallId: string,
  argumentsRecord: { [key: string]: JsonValue } | string = {},
  extraData: Record<string, unknown> = {},
  options: { agentId?: string } = {},
): SdkSessionEvent {
  return {
    type: "tool.execution_start",
    ...(options.agentId ? { agentId: options.agentId } : {}),
    data: {
      toolName,
      toolCallId,
      arguments: argumentsRecord,
      ...extraData,
    },
  };
}

function toolExecutionProgress(toolCallId: string, progressMessage: string): SdkSessionEvent {
  return {
    type: "tool.execution_progress",
    data: {
      toolCallId,
      progressMessage,
    },
  };
}

function toolExecutionComplete(
  toolCallId: string,
  options: {
    success: boolean;
    resultContent?: string;
    detailedContent?: string;
    errorMessage?: string;
    agentId?: string;
  },
): SdkSessionEvent {
  return {
    type: "tool.execution_complete",
    ...(options.agentId ? { agentId: options.agentId } : {}),
    data: {
      toolCallId,
      success: options.success,
      ...(options.resultContent !== undefined || options.detailedContent !== undefined
        ? {
            result: {
              ...(options.resultContent !== undefined ? { content: options.resultContent } : {}),
              ...(options.detailedContent !== undefined
                ? { detailedContent: options.detailedContent }
                : {}),
            },
          }
        : {}),
      ...(options.errorMessage !== undefined ? { error: { message: options.errorMessage } } : {}),
    },
  };
}

function expectOmittedToolLifecycle(
  context: ReturnType<typeof createStreamingContext>,
  options: {
    toolName: string;
    toolCallId: string;
    argumentsRecord?: { [key: string]: JsonValue };
    startEvents?: SessionEvent[];
    completionSuccess?: boolean;
    completionResultContent?: string;
    completionErrorMessage?: string;
  },
) {
  expect(
    projectSdkEvent(
      toolExecutionStart(options.toolName, options.toolCallId, options.argumentsRecord),
      context,
    ),
  ).toEqual(options.startEvents ?? []);

  expect(
    projectSdkEvent(toolExecutionProgress(options.toolCallId, "still omitted"), context),
  ).toEqual([]);

  expect(
    projectSdkEvent(
      toolExecutionComplete(options.toolCallId, {
        success: options.completionSuccess ?? true,
        resultContent: options.completionResultContent,
        errorMessage: options.completionErrorMessage,
      }),
      context,
    ),
  ).toEqual([]);
}

function expectVisibleToolLifecycle(
  context: ReturnType<typeof createStreamingContext>,
  options: {
    toolName: string;
    toolCallId: string;
    argumentsRecord?: { [key: string]: JsonValue };
    progressMessage: string;
    resultContent: string;
  },
) {
  expect(
    projectSdkEvent(
      toolExecutionStart(options.toolName, options.toolCallId, options.argumentsRecord),
      context,
    ),
  ).toEqual([
    {
      type: "tool_start",
      toolName: options.toolName,
      toolCallId: options.toolCallId,
      arguments: options.argumentsRecord ?? {},
    },
  ]);

  // Progress events carry no canonical meaning (nothing downstream consumes
  // them) and project to nothing for visible and omitted tools alike.
  expect(
    projectSdkEvent(toolExecutionProgress(options.toolCallId, options.progressMessage), context),
  ).toEqual([]);

  expect(
    projectSdkEvent(
      toolExecutionComplete(options.toolCallId, {
        success: true,
        resultContent: options.resultContent,
      }),
      context,
    ),
  ).toEqual([
    {
      type: "tool_end",
      toolCallId: options.toolCallId,
      success: true,
      result: options.resultContent,
    },
  ]);
}

describe("projector", () => {
  // ── Streaming: the live event pipeline ────────────────────────────────

  describe("streaming: visible tool calls", () => {
    test("projects normal tool calls into visible tool lifecycle events", () => {
      const context = createStreamingContext();

      expectVisibleToolLifecycle(context, {
        toolName: "write_file",
        toolCallId: "tool-write",
        argumentsRecord: { filePath: "notes.md" },
        progressMessage: "Writing file",
        resultContent: "done",
      });
    });

    test("failed tool calls surface the error message as the result", () => {
      const context = createStreamingContext();
      projectSdkEvent(toolExecutionStart("bash", "tool-fail", { command: "exit 1" }), context);

      expect(
        projectSdkEvent(
          toolExecutionComplete("tool-fail", { success: false, errorMessage: "command failed" }),
          context,
        ),
      ).toEqual([
        {
          type: "tool_end",
          toolCallId: "tool-fail",
          success: false,
          result: "command failed",
          details: undefined,
        },
      ]);
    });

    test("projects apply_patch as patch with freeform arguments and detailed completion diffs", () => {
      const context = createStreamingContext();

      expect(
        projectSdkEvent(toolExecutionStart("apply_patch", "tool-patch", PATCH_TEXT), context),
      ).toEqual([
        {
          type: "tool_start",
          toolName: "patch",
          toolCallId: "tool-patch",
          arguments: { patch: PATCH_TEXT },
        },
      ]);

      expect(
        projectSdkEvent(
          toolExecutionComplete("tool-patch", {
            success: true,
            resultContent: "Modified 1 file(s)",
            detailedContent: PATCH_DIFF,
          }),
          context,
        ),
      ).toEqual([
        {
          type: "tool_end",
          toolCallId: "tool-patch",
          success: true,
          result: "Modified 1 file(s)",
          details: PATCH_DIFF,
        },
      ]);
    });
  });

  describe("streaming: subagents", () => {
    test("subagent tool calls carry their parent agent id from the event envelope", () => {
      const context = createStreamingContext();

      expect(
        projectSdkEvent(
          toolExecutionStart("view", "sub-1", { path: "a.ts" }, {}, { agentId: "call-task-9" }),
          context,
        ),
      ).toEqual([
        {
          type: "tool_start",
          toolName: "read",
          toolCallId: "sub-1",
          agentId: "call-task-9",
          arguments: { path: "a.ts" },
        },
      ]);

      expect(
        projectSdkEvent(
          toolExecutionComplete("sub-1", {
            success: true,
            resultContent: "ok",
            agentId: "call-task-9",
          }),
          context,
        ),
      ).toEqual([
        {
          type: "tool_end",
          toolCallId: "sub-1",
          agentId: "call-task-9",
          success: true,
          result: "ok",
          details: undefined,
        },
      ]);
    });

    test("background agent calls suppress the early tool_end and complete via subagent.completed", () => {
      const context = createStreamingContext();

      expect(
        projectSdkEvent(
          toolExecutionStart("task", "call-bg-1", { agentName: "explore", mode: "background" }),
          context,
        ),
      ).toEqual([
        {
          type: "tool_start",
          toolName: "agent",
          toolCallId: "call-bg-1",
          arguments: { agentName: "explore", mode: "background" },
        },
      ]);

      // The SDK emits an early tool_end ("Agent started in background...") — skipped.
      expect(
        projectSdkEvent(
          toolExecutionComplete("call-bg-1", {
            success: true,
            resultContent: "Agent started in background",
          }),
          context,
        ),
      ).toEqual([]);

      // The real completion signal arrives via subagent.completed.
      expect(
        projectSdkEvent({ type: "subagent.completed", data: { toolCallId: "call-bg-1" } }, context),
      ).toEqual([{ type: "tool_end", toolCallId: "call-bg-1", success: true }]);
    });

    test("failed background agents emit a failed tool_end via subagent.failed", () => {
      const context = createStreamingContext();
      projectSdkEvent(toolExecutionStart("task", "call-bg-2", { mode: "background" }), context);
      projectSdkEvent(toolExecutionComplete("call-bg-2", { success: true }), context);

      expect(
        projectSdkEvent({ type: "subagent.failed", data: { toolCallId: "call-bg-2" } }, context),
      ).toEqual([{ type: "tool_end", toolCallId: "call-bg-2", success: false }]);
    });
  });

  describe("streaming: omitted and translated tools", () => {
    test("every omitted tool is omitted across start, progress, and completion", () => {
      const context = createStreamingContext();

      for (const [i, toolName] of OMITTED_TOOL_NAMES.entries()) {
        expectOmittedToolLifecycle(context, {
          toolName,
          toolCallId: `tool-omitted-${i}`,
          argumentsRecord: {},
          completionResultContent: "done",
        });
      }
    });

    test("open_session and close_session emit linked-session events immediately and are omitted", () => {
      const context = createStreamingContext();

      expectOmittedToolLifecycle(context, {
        toolName: "open_session",
        toolCallId: "tool-open-session",
        argumentsRecord: { sessionId: "toy-box-linked-1" },
        startEvents: [{ type: "linked_session_added", sessionId: "toy-box-linked-1" }],
        completionResultContent: "Session toy-box-linked-1 opened.",
      });

      expectOmittedToolLifecycle(context, {
        toolName: "close_session",
        toolCallId: "tool-close-session",
        argumentsRecord: { sessionId: "toy-box-linked-1" },
        startEvents: [{ type: "linked_session_removed", sessionId: "toy-box-linked-1" }],
        completionResultContent: "Session toy-box-linked-1 closed.",
      });
    });

    test("delete_session removes linked sessions immediately and is omitted", () => {
      const context = createStreamingContext();

      expectOmittedToolLifecycle(context, {
        toolName: "delete_session",
        toolCallId: "tool-delete-session",
        argumentsRecord: { sessionId: "toy-box-created-1" },
        startEvents: [{ type: "linked_session_removed", sessionId: "toy-box-created-1" }],
        completionResultContent: '{"deleted":true}',
      });
    });

    test("create_session projects a linked session only after successful completion", () => {
      const context = createStreamingContext();

      expect(
        projectSdkEvent(
          toolExecutionStart("create_session", "tool-create-session", {
            prompt: "Review the auth flow",
          }),
          context,
        ),
      ).toEqual([]);

      expect(
        projectSdkEvent(toolExecutionProgress("tool-create-session", "Creating"), context),
      ).toEqual([]);

      expect(
        projectSdkEvent(
          toolExecutionComplete("tool-create-session", {
            success: true,
            resultContent: JSON.stringify({ sessionId: "toy-box-created-1" }),
          }),
          context,
        ),
      ).toEqual([{ type: "linked_session_added", sessionId: "toy-box-created-1" }]);
    });

    test("failed create_session completions are omitted and emit no linked session", () => {
      const context = createStreamingContext();

      expectOmittedToolLifecycle(context, {
        toolName: "create_session",
        toolCallId: "tool-create-session-failed",
        argumentsRecord: { prompt: "Review the auth flow" },
        completionSuccess: false,
        completionErrorMessage: "boom",
      });
    });
  });

  describe("streaming: todo SQL", () => {
    test("sql insert and update statements emit todo patches and are omitted", () => {
      const context = createStreamingContext();

      expectOmittedToolLifecycle(context, {
        toolName: "sql",
        toolCallId: "tool-insert",
        argumentsRecord: {
          query:
            "INSERT INTO todos (id, title) VALUES ('inspect-sql-events', 'inspect SQL events');" +
            "UPDATE todos SET status = 'done' WHERE id = 'inspect-sql-events';",
        },
        startEvents: [
          {
            type: "todos_patch",
            patches: [
              {
                type: "upsert",
                id: "inspect-sql-events",
                title: "inspect SQL events",
                status: "pending",
              },
              {
                type: "upsert",
                id: "inspect-sql-events",
                status: "done",
              },
            ],
          },
        ],
        completionResultContent: "done",
      });
    });

    test("sql select statements are omitted without emitting todo patches", () => {
      const context = createStreamingContext();

      expectOmittedToolLifecycle(context, {
        toolName: "sql",
        toolCallId: "tool-select",
        argumentsRecord: { query: "SELECT id, title, status FROM todos;" },
        startEvents: [],
        completionResultContent: "3 row(s) returned.",
      });
    });

    test("sql delete statements emit delete patches and are omitted", () => {
      const context = createStreamingContext();

      expectOmittedToolLifecycle(context, {
        toolName: "sql",
        toolCallId: "tool-delete",
        argumentsRecord: { query: "DELETE FROM todos WHERE id = 'inspect-sql-events';" },
        startEvents: [
          {
            type: "todos_patch",
            patches: [{ type: "delete", id: "inspect-sql-events" }],
          },
        ],
        completionResultContent: "1 row(s) deleted.",
      });
    });

    test("sql bulk status updates emit update-all patches on start", () => {
      const context = createStreamingContext();

      expect(
        projectSdkEvent(
          toolExecutionStart("sql", "tool-update-all", {
            query: "UPDATE todos SET status = 'done';",
          }),
          context,
        ),
      ).toEqual([
        {
          type: "todos_patch",
          patches: [{ type: "update_all", status: "done" }],
        },
      ]);
    });

    test("failed sql mutations keep their optimistic todo patches and are omitted", () => {
      const context = createStreamingContext();

      expectOmittedToolLifecycle(context, {
        toolName: "sql",
        toolCallId: "tool-failed",
        argumentsRecord: {
          query: "UPDATE todos SET status = 'done' WHERE id = 'inspect-sql-events';",
        },
        startEvents: [
          {
            type: "todos_patch",
            patches: [{ type: "upsert", id: "inspect-sql-events", status: "done" }],
          },
        ],
        completionSuccess: false,
        completionErrorMessage: "boom",
      });
    });
  });

  describe("streaming: deltas", () => {
    test("drops empty-content deltas at the source", () => {
      const context = createStreamingContext();

      expect(
        projectSdkEvent({ type: "assistant.message_delta", data: { deltaContent: "" } }, context),
      ).toEqual([]);
      expect(
        projectSdkEvent({ type: "assistant.reasoning_delta", data: { deltaContent: "" } }, context),
      ).toEqual([]);

      expect(
        projectSdkEvent({ type: "assistant.message_delta", data: { deltaContent: "Hi" } }, context),
      ).toEqual([{ type: "delta", content: "Hi" }]);
      expect(
        projectSdkEvent(
          { type: "assistant.reasoning_delta", data: { deltaContent: "Hmm" } },
          context,
        ),
      ).toEqual([{ type: "reasoning", content: "Hmm" }]);
    });

    test("drops subagent text deltas and scopes subagent reasoning deltas", () => {
      const context = createStreamingContext();

      expect(
        projectSdkEvent(
          {
            type: "assistant.message_delta",
            agentId: "call-agent-1",
            data: { deltaContent: "Subagent text" },
          },
          context,
        ),
      ).toEqual([]);

      expect(
        projectSdkEvent(
          {
            type: "assistant.reasoning_delta",
            agentId: "call-agent-1",
            data: { deltaContent: "Subagent reasoning" },
          },
          context,
        ),
      ).toEqual([{ type: "reasoning", agentId: "call-agent-1", content: "Subagent reasoning" }]);
    });
  });

  describe("streaming: session events", () => {
    test("drops subagent status events so they do not mutate root status", () => {
      const context = createStreamingContext();

      expect(projectSdkEvent({ type: "assistant.turn_start", data: {} }, context)).toEqual([
        { type: "thinking" },
      ]);
      expect(
        projectSdkEvent(
          { type: "assistant.turn_start", agentId: "call-agent-1", data: {} },
          context,
        ),
      ).toEqual([]);

      expect(projectSdkEvent({ type: "session.compaction_start", data: {} }, context)).toEqual([
        { type: "compacting_start" },
      ]);
      expect(
        projectSdkEvent(
          { type: "session.compaction_start", agentId: "call-agent-1", data: {} },
          context,
        ),
      ).toEqual([]);

      expect(projectSdkEvent({ type: "session.compaction_complete", data: {} }, context)).toEqual([
        { type: "compacting_end" },
      ]);
      expect(
        projectSdkEvent(
          { type: "session.compaction_complete", agentId: "call-agent-1", data: {} },
          context,
        ),
      ).toEqual([]);
    });

    test("projects model and title events into canonical session events", () => {
      const context = createStreamingContext();

      expect(projectSdkEvent(modelChange("claude-sonnet-4.6"), context)).toEqual([
        { type: "model_changed", modelConfiguration: { model: "claude-sonnet-4.6" } },
      ]);

      expect(projectSdkEvent(modelChange("gpt-5", "high"), context)).toEqual([
        {
          type: "model_changed",
          modelConfiguration: { model: "gpt-5", reasoningEffort: "high" },
        },
      ]);

      expect(projectSdkEvent(titleChanged("Friendly title"), context)).toEqual([
        { type: "session_title_changed", title: "Friendly title" },
      ]);
    });

    test("projects subagent start model as a scoped model change", () => {
      const context = createStreamingContext();

      expect(
        projectSdkEvent(
          {
            type: "subagent.started",
            agentId: "call-agent-1",
            data: {
              toolCallId: "call-agent-1",
              agentName: "explore",
              agentDisplayName: "Explore Agent",
              agentDescription: "Searches code.",
              model: "claude-haiku-4.5",
            },
          },
          context,
        ),
      ).toEqual([
        {
          type: "model_changed",
          agentId: "call-agent-1",
          modelConfiguration: { model: "claude-haiku-4.5" },
        },
      ]);
    });

    test("returns no events for unknown SDK event types", () => {
      expect(
        projectSdkEvent({ type: "unknown.event", data: {} }, createStreamingContext()),
      ).toEqual([]);
    });
  });

  // ── History: replaying a recorded session into a transcript ───────────

});

// Golden replays of real session fixtures live in tests/ (see tests/AGENTS.md).
