import { describe, expect, test } from "bun:test";
import {
  createProjectionState,
  projectSdkEvent,
  projectSessionEventsFromSdkHistory,
} from "@/functions/sdk/projector";
import type { SdkSessionEvent } from "@/functions/sdk/extractors";
import type { Attachment, JsonValue, SessionEvent } from "@/types";

function createStreamingContext() {
  return { streaming: true as const, state: createProjectionState() };
}

function userMessage(
  content: string,
  options: {
    timestamp?: string;
    attachments?: Array<{ displayName: string; path?: string }>;
  } = {},
): SdkSessionEvent {
  return {
    type: "user.message",
    ...(options.timestamp ? { timestamp: options.timestamp } : {}),
    data: {
      content,
      ...(options.attachments ? { attachments: options.attachments } : {}),
    },
  };
}

function assistantMessage(
  content: string,
  toolRequests?: Array<{
    toolCallId?: string;
    name: string;
    arguments?: { [key: string]: JsonValue };
  }>,
): SdkSessionEvent {
  return {
    type: "assistant.message",
    data: {
      content,
      ...(toolRequests ? { toolRequests } : {}),
    },
  };
}

function modelChange(newModel: string): SdkSessionEvent {
  return {
    type: "session.model_change",
    data: { newModel },
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
  argumentsRecord: { [key: string]: JsonValue } = {},
  extraData: Record<string, unknown> = {},
): SdkSessionEvent {
  return {
    type: "tool.execution_start",
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
    errorMessage?: string;
    parentToolCallId?: string;
  },
): SdkSessionEvent {
  return {
    type: "tool.execution_complete",
    data: {
      toolCallId,
      parentToolCallId: options.parentToolCallId,
      success: options.success,
      ...(options.resultContent !== undefined
        ? { result: { content: options.resultContent } }
        : {}),
      ...(options.errorMessage !== undefined ? { error: { message: options.errorMessage } } : {}),
    },
  };
}

function successfulHiddenToolHistory(
  toolName: string,
  toolCallId: string,
  argumentsRecord: { [key: string]: JsonValue },
  resultContent: string,
): SdkSessionEvent[] {
  return [
    toolExecutionStart(toolName, toolCallId, argumentsRecord),
    toolExecutionComplete(toolCallId, {
      success: true,
      resultContent,
    }),
  ];
}

async function projectHistory(
  events: SdkSessionEvent[],
  attachments?: Attachment[],
): Promise<SessionEvent[]> {
  const projected: SessionEvent[] = [];
  for await (const event of projectSessionEventsFromSdkHistory(events, {
    resolveAttachments: attachments ? async () => attachments : undefined,
  })) {
    projected.push(event);
  }
  return projected;
}

function expectStartOnlyProjection(
  context: ReturnType<typeof createStreamingContext>,
  event: SdkSessionEvent,
  expected: SessionEvent[],
) {
  expect(projectSdkEvent(event, context)).toEqual(expected);
}

function expectSuppressedToolLifecycle(
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
    projectSdkEvent(toolExecutionProgress(options.toolCallId, "still hidden"), context),
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
      parentToolCallId: undefined,
      arguments: options.argumentsRecord ?? {},
    },
  ]);

  expect(
    projectSdkEvent(toolExecutionProgress(options.toolCallId, options.progressMessage), context),
  ).toEqual([
    { type: "tool_progress", toolCallId: options.toolCallId, message: options.progressMessage },
  ]);

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
      parentToolCallId: undefined,
      success: true,
      result: options.resultContent,
    },
  ]);
}

describe("projector", () => {
  describe("streaming tool calls", () => {
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

    test("open_session and close_session emit linked-session events immediately and stay suppressed", () => {
      const context = createStreamingContext();

      expectSuppressedToolLifecycle(context, {
        toolName: "open_session",
        toolCallId: "tool-open-session",
        argumentsRecord: { sessionId: "toy-box-linked-1" },
        startEvents: [{ type: "linked_session_added", sessionId: "toy-box-linked-1" }],
        completionResultContent: "Session toy-box-linked-1 opened.",
      });

      expectSuppressedToolLifecycle(context, {
        toolName: "close_session",
        toolCallId: "tool-close-session",
        argumentsRecord: { sessionId: "toy-box-linked-1" },
        startEvents: [{ type: "linked_session_removed", sessionId: "toy-box-linked-1" }],
        completionResultContent: "Session toy-box-linked-1 closed.",
      });
    });

    test("delete_session removes linked sessions immediately and stays suppressed", () => {
      const context = createStreamingContext();

      expectSuppressedToolLifecycle(context, {
        toolName: "delete_session",
        toolCallId: "tool-delete-session",
        argumentsRecord: { sessionId: "toy-box-created-1" },
        startEvents: [{ type: "linked_session_removed", sessionId: "toy-box-created-1" }],
        completionResultContent: '{"deleted":true}',
      });
    });

    test("create_session projects a linked session only after successful completion", () => {
      const context = createStreamingContext();

      expectStartOnlyProjection(
        context,
        toolExecutionStart("create_session", "tool-create-session", {
          prompt: "Review the auth flow",
        }),
        [],
      );

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

    test("failed create_session completions stay suppressed and emit no linked session", () => {
      const context = createStreamingContext();

      expectSuppressedToolLifecycle(context, {
        toolName: "create_session",
        toolCallId: "tool-create-session-failed",
        argumentsRecord: { prompt: "Review the auth flow" },
        completionSuccess: false,
        completionErrorMessage: "boom",
      });
    });

    test("suppression-only tools stay hidden across start, progress, and completion", () => {
      const context = createStreamingContext();

      expectSuppressedToolLifecycle(context, {
        toolName: "read_agent",
        toolCallId: "tool-hidden",
        argumentsRecord: {},
        completionResultContent: "done",
      });
    });

    test("sql insert and update statements emit todo patches and stay suppressed", () => {
      const context = createStreamingContext();

      expectSuppressedToolLifecycle(context, {
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

    test("sql select statements stay suppressed without emitting todo patches", () => {
      const context = createStreamingContext();

      expectSuppressedToolLifecycle(context, {
        toolName: "sql",
        toolCallId: "tool-select",
        argumentsRecord: { query: "SELECT id, title, status FROM todos;" },
        startEvents: [],
        completionResultContent: "3 row(s) returned.",
      });
    });

    test("sql delete statements emit delete patches and stay suppressed", () => {
      const context = createStreamingContext();

      expectSuppressedToolLifecycle(context, {
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

    test("failed sql mutations keep their optimistic todo patches and stay suppressed", () => {
      const context = createStreamingContext();

      expectSuppressedToolLifecycle(context, {
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

    test("sql bulk status updates emit update-all patches on start", () => {
      const context = createStreamingContext();

      expectStartOnlyProjection(
        context,
        toolExecutionStart("sql", "tool-update-all", {
          query: "UPDATE todos SET status = 'done';",
        }),
        [
          {
            type: "todos_patch",
            patches: [{ type: "update_all", status: "done" }],
          },
        ],
      );
    });
  });

  describe("streaming non-tool events", () => {
    test("projects model and title events into canonical session events", () => {
      const context = createStreamingContext();

      expect(projectSdkEvent(modelChange("claude-sonnet-4.6"), context)).toEqual([
        { type: "model_changed", model: "claude-sonnet-4.6" },
      ]);

      expect(projectSdkEvent(titleChanged("Friendly title"), context)).toEqual([
        { type: "session_title_changed", title: "Friendly title" },
      ]);
    });

    test("returns no events for unknown SDK event types", () => {
      expect(
        projectSdkEvent({ type: "unknown.event", data: {} }, createStreamingContext()),
      ).toEqual([]);
    });
  });

  describe("history adaptation", () => {
    test("replays model changes from session lifecycle events", async () => {
      const adapted = await projectHistory([
        {
          type: "session.start",
          data: {
            selectedModel: "claude-sonnet-4.5",
          },
        },
        modelChange("claude-sonnet-4.6"),
      ]);

      expect(adapted).toEqual([
        { type: "model_changed", model: "claude-sonnet-4.5" },
        { type: "model_changed", model: "claude-sonnet-4.6" },
      ]);
    });

    test("keeps suppressed SQL tool calls out of assistant tool calls while preserving todo patches", async () => {
      const attachments: Attachment[] = [
        {
          displayName: "image.png",
          mimeType: "image/png",
        },
      ];

      const adapted = await projectHistory(
        [
          userMessage("User prompt", {
            timestamp: "2026-01-01T00:00:00.000Z",
            attachments: [{ displayName: "image.png", path: "/tmp/image.png" }],
          }),
          assistantMessage("Assistant response", [
            {
              toolCallId: "todo-call",
              name: "sql",
              arguments: {
                query:
                  "INSERT INTO todos (id, title) VALUES ('inspect-sql-events', 'inspect SQL events');",
              },
            },
            {
              toolCallId: "call-1",
              name: "write_file",
              arguments: { filePath: "notes.md" },
            },
          ]),
          toolExecutionStart("sql", "todo-call", {
            query:
              "INSERT INTO todos (id, title) VALUES ('inspect-sql-events', 'inspect SQL events');",
          }),
          toolExecutionComplete("todo-call", {
            success: true,
            resultContent: "done",
          }),
          toolExecutionComplete("call-1", {
            success: true,
            resultContent: "done",
          }),
          titleChanged("Friendly title"),
        ],
        attachments,
      );

      expect(adapted).toEqual([
        {
          type: "user_message",
          content: "User prompt",
          timestamp: "2026-01-01T00:00:00.000Z",
          attachments,
        },
        {
          type: "assistant_message",
          content: "Assistant response",
          toolCalls: [
            {
              toolCallId: "call-1",
              toolName: "write_file",
              arguments: { filePath: "notes.md" },
              result: { content: "done", success: true },
            },
          ],
        },
        {
          type: "todos_patch",
          patches: [
            {
              type: "upsert",
              id: "inspect-sql-events",
              title: "inspect SQL events",
              status: "pending",
            },
          ],
        },
        { type: "session_title_changed", title: "Friendly title" },
      ]);
    });

    test("restores create_session links without surfacing the suppressed tool call", async () => {
      const adapted = await projectHistory([
        assistantMessage("Opening a companion session.", [
          {
            toolCallId: "tool-create-session",
            name: "create_session",
            arguments: {
              prompt: "Inspect the API errors",
            },
          },
        ]),
        toolExecutionStart("create_session", "tool-create-session", {
          prompt: "Inspect the API errors",
        }),
        toolExecutionComplete("tool-create-session", {
          success: true,
          resultContent: JSON.stringify({ sessionId: "toy-box-created-2" }),
        }),
      ]);

      expect(adapted).toEqual([
        {
          type: "assistant_message",
          content: "Opening a companion session.",
          toolCalls: undefined,
        },
        {
          type: "linked_session_added",
          sessionId: "toy-box-created-2",
        },
      ]);
    });

    test("keeps suppression-only session coordination tools hidden in history", async () => {
      const adapted = await projectHistory([
        ...successfulHiddenToolHistory(
          "check_session_status",
          "tool-check-session",
          { sessionId: "toy-box-created-2" },
          JSON.stringify({ running: false, queuedCount: 0 }),
        ),
        ...successfulHiddenToolHistory(
          "wait_for_sessions",
          "tool-wait-sessions",
          { sessionIds: ["toy-box-created-2"] },
          JSON.stringify({
            responses: [{ sessionId: "toy-box-created-2", response: "done" }],
          }),
        ),
      ]);

      expect(adapted).toEqual([]);
    });

    test("keeps automation tools hidden in history", async () => {
      const adapted = await projectHistory([
        ...successfulHiddenToolHistory(
          "list_automations",
          "tool-list-automations",
          {},
          JSON.stringify({
            automations: [{ id: "automation-1", title: "Daily Summary" }],
          }),
        ),
        ...successfulHiddenToolHistory(
          "run_automation",
          "tool-run-automation",
          { automationId: "automation-1" },
          JSON.stringify({ sessionId: "automation-session-1" }),
        ),
      ]);

      expect(adapted).toEqual([]);
    });

    test("adapts malformed tool requests without dropping valid sibling tool calls", async () => {
      let attachmentResolverCalls = 0;
      const attachments: Attachment[] = [{ displayName: "photo.png", mimeType: "image/png" }];
      const adapted: SessionEvent[] = [];

      for await (const event of projectSessionEventsFromSdkHistory(
        [
          assistantMessage("A", [
            { name: "missing_id", arguments: { value: 1 } },
            { toolCallId: "call-2", name: "write_file", arguments: { filePath: "notes.md" } },
          ]),
          toolExecutionComplete("call-2", {
            success: true,
            resultContent: "",
          }),
          userMessage("User prompt"),
        ],
        {
          resolveAttachments: async () => {
            attachmentResolverCalls += 1;
            return attachments;
          },
        },
      )) {
        adapted.push(event);
      }

      expect(adapted).toEqual([
        {
          type: "assistant_message",
          content: "A",
          toolCalls: [
            {
              toolCallId: "call-2",
              toolName: "write_file",
              arguments: { filePath: "notes.md" },
              result: { content: "", success: true },
              childToolCalls: undefined,
            },
          ],
        },
        {
          type: "user_message",
          content: "User prompt",
          timestamp: undefined,
          attachments,
        },
      ]);
      expect(attachmentResolverCalls).toBe(1);
    });
  });
});
