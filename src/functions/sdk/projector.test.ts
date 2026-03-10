import { describe, expect, test } from "bun:test";
import {
  createProjectionState,
  projectSdkEvent,
  projectSessionEventsFromSdkHistory,
} from "@/functions/sdk/projector";
import type { SdkSessionEvent } from "@/functions/sdk/extractors";
import type { Attachment, SessionEvent } from "@/types";

function createStreamingContext() {
  return { streaming: true as const, state: createProjectionState() };
}

async function collectProjectedHistoryEvents(
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

describe("session adapters", () => {
  test("sql todo tool calls emit todo patches on start and stay hidden afterward", () => {
    const context = createStreamingContext();

    expect(
      projectSdkEvent(
        {
          type: "tool.execution_start",
          data: {
            toolName: "sql",
            toolCallId: "tool-1",
            arguments: {
              query:
                "INSERT INTO todos (id, title) VALUES ('inspect-sql-events', 'inspect SQL events');" +
                "UPDATE todos SET status = 'done' WHERE id = 'inspect-sql-events';",
            },
          },
        },
        context,
      ),
    ).toEqual([
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
    ]);

    expect(
      projectSdkEvent(
        {
          type: "tool.execution_progress",
          data: {
            toolCallId: "tool-1",
            progressMessage: "Executing SQL",
          },
        },
        context,
      ),
    ).toEqual([]);

    expect(
      projectSdkEvent(
        {
          type: "tool.execution_complete",
          data: {
            toolCallId: "tool-1",
            success: true,
            result: { content: "done" },
          },
        },
        context,
      ),
    ).toEqual([]);
  });

  test("todo select sql stays hidden and no-ops on completion", () => {
    const context = createStreamingContext();

    expect(
      projectSdkEvent(
        {
          type: "tool.execution_start",
          data: {
            toolName: "sql",
            toolCallId: "tool-select",
            arguments: {
              query: "SELECT id, title, status FROM todos;",
            },
          },
        },
        context,
      ),
    ).toEqual([]);

    expect(
      projectSdkEvent(
        {
          type: "tool.execution_complete",
          data: {
            toolCallId: "tool-select",
            success: true,
            result: { content: "3 row(s) returned." },
          },
        },
        context,
      ),
    ).toEqual([]);
  });

  test("todo delete sql emits delete patches on start and stays hidden afterward", () => {
    const context = createStreamingContext();

    expect(
      projectSdkEvent(
        {
          type: "tool.execution_start",
          data: {
            toolName: "sql",
            toolCallId: "tool-delete",
            arguments: {
              query: "DELETE FROM todos WHERE id = 'inspect-sql-events';",
            },
          },
        },
        context,
      ),
    ).toEqual([
      {
        type: "todos_patch",
        patches: [{ type: "delete", id: "inspect-sql-events" }],
      },
    ]);

    expect(
      projectSdkEvent(
        {
          type: "tool.execution_complete",
          data: {
            toolCallId: "tool-delete",
            success: true,
            result: { content: "1 row(s) deleted." },
          },
        },
        context,
      ),
    ).toEqual([]);
  });

  test("failed todo sql completions remain hidden after optimistic start patches", () => {
    const context = createStreamingContext();

    expect(
      projectSdkEvent(
        {
          type: "tool.execution_start",
          data: {
            toolName: "sql",
            toolCallId: "tool-failed",
            arguments: {
              query: "UPDATE todos SET status = 'done' WHERE id = 'inspect-sql-events';",
            },
          },
        },
        context,
      ),
    ).toEqual([
      {
        type: "todos_patch",
        patches: [{ type: "upsert", id: "inspect-sql-events", status: "done" }],
      },
    ]);

    expect(
      projectSdkEvent(
        {
          type: "tool.execution_complete",
          data: {
            toolCallId: "tool-failed",
            success: false,
            error: { message: "boom" },
          },
        },
        context,
      ),
    ).toEqual([]);
  });

  test("todo bulk status updates emit update-all patches on start", () => {
    const context = createStreamingContext();

    expect(
      projectSdkEvent(
        {
          type: "tool.execution_start",
          data: {
            toolName: "sql",
            toolCallId: "tool-update-all",
            arguments: {
              query: "UPDATE todos SET status = 'done';",
            },
          },
        },
        context,
      ),
    ).toEqual([
      {
        type: "todos_patch",
        patches: [{ type: "update_all", status: "done" }],
      },
    ]);
  });

  test("unknown event types return empty array", () => {
    expect(projectSdkEvent({ type: "unknown.event", data: {} }, createStreamingContext())).toEqual(
      [],
    );
  });

  test("history adaptation includes the initial session model from session.start", async () => {
    const adapted = await collectProjectedHistoryEvents([
      {
        type: "session.start",
        data: {
          selectedModel: "claude-sonnet-4.5",
        },
      },
      {
        type: "session.model_change",
        data: {
          newModel: "claude-sonnet-4.6",
        },
      },
    ]);

    expect(adapted).toEqual([
      { type: "model_changed", model: "claude-sonnet-4.5" },
      { type: "model_changed", model: "claude-sonnet-4.6" },
    ]);
  });

  test("history adaptation hides todo sql tool calls while preserving todo patches", async () => {
    const attachments: Attachment[] = [
      {
        displayName: "image.png",
        mimeType: "image/png",
      },
    ];

    const events: SdkSessionEvent[] = [
      {
        type: "user.message",
        timestamp: "2026-01-01T00:00:00.000Z",
        data: {
          content: "User prompt",
          attachments: [{ displayName: "image.png", path: "/tmp/image.png" }],
        },
      },
      {
        type: "assistant.message",
        data: {
          content: "Assistant response",
          toolRequests: [
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
          ],
        },
      },
      {
        type: "tool.execution_start",
        data: {
          toolName: "sql",
          toolCallId: "todo-call",
          arguments: {
            query:
              "INSERT INTO todos (id, title) VALUES ('inspect-sql-events', 'inspect SQL events');",
          },
        },
      },
      {
        type: "tool.execution_complete",
        data: {
          toolCallId: "todo-call",
          success: true,
          result: { content: "done" },
        },
      },
      {
        type: "tool.execution_complete",
        data: {
          toolCallId: "call-1",
          success: true,
          result: { content: "done" },
        },
      },
      {
        type: "session.title_changed",
        data: {
          title: "Friendly title",
        },
      },
    ];

    const adapted = await collectProjectedHistoryEvents(events, attachments);

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

  test("adapts history robustly when tool requests are malformed", async () => {
    let attachmentResolverCalls = 0;
    const attachments: Attachment[] = [{ displayName: "photo.png", mimeType: "image/png" }];
    const events: SdkSessionEvent[] = [
      {
        type: "assistant.message",
        data: {
          content: "A",
          toolRequests: [
            { name: "missing_id", arguments: { value: 1 } },
            { toolCallId: "call-2", name: "write_file", arguments: { filePath: "notes.md" } },
          ],
        },
      },
      {
        type: "tool.execution_complete",
        data: {
          toolCallId: "call-2",
          success: true,
          result: {},
        },
      },
      {
        type: "user.message",
        data: {
          content: "User prompt",
        },
      },
    ];

    const adapted: SessionEvent[] = [];
    for await (const event of projectSessionEventsFromSdkHistory(events, {
      resolveAttachments: async () => {
        attachmentResolverCalls += 1;
        return attachments;
      },
    })) {
      adapted.push(event);
    }

    expect(adapted[0]).toEqual({
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
    });
    expect(adapted[1]).toEqual({
      type: "user_message",
      content: "User prompt",
      timestamp: undefined,
      attachments,
    });
    expect(attachmentResolverCalls).toBe(1);
  });
});
