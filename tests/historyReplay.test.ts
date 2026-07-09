import { describe, expect, test } from "bun:test";
import type { SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";
import { replaySdkHistory } from "@/functions/sdk/historyReplay";
import type { Session } from "@/lib/session/sessionReducer";
import { loadSessionFixture } from "./helpers";

// State-level history replay coverage: persisted SDK events → historyReplay
// adapter → streaming projector → sessionReducer → final Session. Assertions
// target the reduced Session because that is the replay contract — the
// emitted event stream is an implementation detail of the streaming
// projection, which has its own unit suite (projector.test.ts).

const replayHistory = (events: SdkSessionEvent[]) =>
  replaySdkHistory("history-replay-session", events);

function assistantToolCalls(state: Session) {
  return state.messages.flatMap((message) =>
    message.role === "assistant" ? (message.toolCalls ?? []) : [],
  );
}

describe("history replay", () => {
  test("replays the subagent fixture through reducer-owned state construction", async () => {
    const state = await replayHistory(await loadSessionFixture("subagents"));
    const agents = assistantToolCalls(state).filter((toolCall) => toolCall.name === "agent");

    expect(state.messages.map((message) => message.role)).toEqual([
      "assistant",
      "user",
      "assistant",
    ]);
    expect(state.messages[0]).toMatchObject({
      role: "assistant",
      toolCalls: [
        {
          id: "call_M1QBw3fDmRrrXoYP9bt4edOd",
          name: "read",
          result: { success: false, content: "Path does not exist" },
        },
      ],
    });
    expect(state.model).toMatchObject({ name: "gpt-5.5", reasoningEffort: "xhigh" });
    expect(agents).toHaveLength(7);
    expect(
      agents
        .map((toolCall) => toolCall.agent?.toolCalls?.length ?? 0)
        .filter((count) => count > 0)
        .sort(),
    ).toEqual([3, 4]);
    expect(state.pendingToolCalls.size).toBe(0);
    expect(state.status).toBe("idle");
  });

  test("replays leading root tool lifecycle events even before a visible turn", async () => {
    const state = await replayHistory([
      {
        type: "tool.execution_start",
        data: {
          toolCallId: "orphan",
          toolName: "view",
          arguments: { path: "old.ts" },
        },
      },
      {
        type: "tool.execution_complete",
        data: {
          toolCallId: "orphan",
          success: true,
          result: { content: "old content" },
        },
      },
      {
        type: "user.message",
        data: { content: "New turn" },
      },
      {
        type: "assistant.message",
        data: { content: "Fresh response" },
      },
    ] as SdkSessionEvent[]);

    expect(state.messages).toEqual([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "orphan",
            name: "read",
            arguments: { path: "old.ts" },
            result: { content: "old content", success: true, details: undefined },
          },
        ],
      },
      { role: "user", content: "New turn", attachments: undefined, timestamp: undefined },
      { role: "assistant", content: "Fresh response" },
    ]);
  });

  test("translates todo SQL into todos, keeps it out of the tool call list, and applies titles", async () => {
    const insertTodo =
      "INSERT INTO todos (id, title) VALUES ('inspect-sql-events', 'inspect SQL events');";
    const state = await replayHistory([
      { type: "user.message", data: { content: "User prompt" } },
      { type: "assistant.message", data: { content: "Assistant response" } },
      {
        type: "tool.execution_start",
        data: { toolCallId: "todo-call", toolName: "sql", arguments: { query: insertTodo } },
      },
      { type: "tool.execution_complete", data: { toolCallId: "todo-call", success: true } },
      {
        type: "tool.execution_start",
        data: { toolCallId: "call-1", toolName: "write_file", arguments: { filePath: "notes.md" } },
      },
      {
        type: "tool.execution_complete",
        data: { toolCallId: "call-1", success: true, result: { content: "done" } },
      },
      { type: "session.title_changed", data: { title: "Friendly title" } },
    ] as SdkSessionEvent[]);

    expect(state.todos).toEqual([
      { id: "inspect-sql-events", title: "inspect SQL events", status: "pending" },
    ]);
    expect(state.summary).toBe("Friendly title");
    expect(assistantToolCalls(state)).toEqual([
      {
        id: "call-1",
        name: "write_file",
        arguments: { filePath: "notes.md" },
        result: { content: "done", success: true, details: undefined },
      },
    ]);
  });

  test("replays session model events through the streaming projector", async () => {
    const state = await replayHistory([
      {
        type: "session.start",
        data: {
          sessionId: "session-1",
          producer: "copilot-agent",
          copilotVersion: "1.0.61",
          startTime: "2026-06-10T20:29:43.232Z",
          selectedModel: "claude-sonnet-4.5",
        },
      },
      { type: "session.model_change", data: { newModel: "claude-sonnet-4.6" } },
    ] as SdkSessionEvent[]);

    expect(state.model).toEqual({ name: "claude-sonnet-4.6" });
  });

  test("normalizes apply_patch string arguments and preserves detailed diffs", async () => {
    const patchText = "*** Begin Patch\n*** Update File: notes.md\n@@\n-old\n+new\n*** End Patch";
    const patchDiff = "diff --git a/notes.md b/notes.md\n@@ -1 +1 @@\n-old\n+new";
    const state = await replayHistory([
      { type: "user.message", data: { content: "Patch it" } },
      { type: "assistant.message", data: { content: "Applying patch." } },
      {
        type: "tool.execution_start",
        data: { toolCallId: "tool-patch", toolName: "apply_patch", arguments: patchText },
      },
      {
        type: "tool.execution_complete",
        data: {
          toolCallId: "tool-patch",
          success: true,
          result: { content: "Modified 1 file(s)", detailedContent: patchDiff },
        },
      },
    ] as SdkSessionEvent[]);

    expect(assistantToolCalls(state)).toEqual([
      {
        id: "tool-patch",
        name: "patch",
        arguments: { patch: patchText },
        result: { content: "Modified 1 file(s)", success: true, details: patchDiff },
      },
    ]);
  });

  test("restores linked sessions without surfacing the translated tool call", async () => {
    const state = await replayHistory([
      { type: "user.message", data: { content: "Spin one up" } },
      { type: "assistant.message", data: { content: "Opening a companion session." } },
      {
        type: "tool.execution_start",
        data: {
          toolCallId: "tool-create-session",
          toolName: "create_session",
          arguments: { prompt: "Inspect the API errors" },
        },
      },
      {
        type: "tool.execution_complete",
        data: {
          toolCallId: "tool-create-session",
          success: true,
          result: { content: JSON.stringify({ sessionId: "toy-box-created-2" }) },
        },
      },
    ] as SdkSessionEvent[]);

    expect(state.linkedSessionIds).toEqual(["toy-box-created-2"]);
    expect(assistantToolCalls(state)).toEqual([]);
  });

  test("keeps omitted tools out of the transcript", async () => {
    const state = await replayHistory([
      { type: "user.message", data: { content: "Check status" } },
      { type: "assistant.message", data: { content: "Checking." } },
      {
        type: "tool.execution_start",
        data: { toolCallId: "om-1", toolName: "read_agent", arguments: {} },
      },
      { type: "tool.execution_complete", data: { toolCallId: "om-1", success: true } },
      {
        type: "tool.execution_start",
        data: { toolCallId: "om-2", toolName: "check_session_status", arguments: {} },
      },
      { type: "tool.execution_complete", data: { toolCallId: "om-2", success: true } },
    ] as SdkSessionEvent[]);

    expect(assistantToolCalls(state)).toEqual([]);
  });

  test("keeps subagent prompts out of the root transcript", async () => {
    const state = await replayHistory([
      { type: "user.message", data: { content: "Real root turn" } },
      { type: "assistant.message", data: { content: "Delegating." } },
      {
        type: "tool.execution_start",
        data: { toolCallId: "agent-1", toolName: "task", arguments: { prompt: "Go explore" } },
      },
      // The subagent's prompt, recorded agent-scoped — already visible as the
      // agent tool call's arguments, so it must not become a root user turn.
      { type: "user.message", agentId: "agent-1", data: { content: "Go explore" } },
      {
        type: "tool.execution_complete",
        data: { toolCallId: "agent-1", success: true, result: { content: "done" } },
      },
    ] as SdkSessionEvent[]);

    expect(state.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(state.messages[0]).toMatchObject({ content: "Real root turn" });
  });

  test("reads persisted blob attachments by default, skipping legacy file entries", async () => {
    const state = await replayHistory([
      {
        type: "user.message",
        timestamp: "2026-01-01T00:00:00.000Z",
        data: {
          content: "What is in this image?",
          attachments: [
            { type: "file", displayName: "legacy.png", path: "/tmp/legacy.png" },
            { type: "blob", data: "aW1hZ2U=", mimeType: "image/png", displayName: "image.png" },
          ],
        },
      },
    ] as SdkSessionEvent[]);

    expect(state.messages).toEqual([
      {
        role: "user",
        content: "What is in this image?",
        timestamp: "2026-01-01T00:00:00.000Z",
        attachments: [{ base64: "aW1hZ2U=", mimeType: "image/png", displayName: "image.png" }],
      },
    ]);
  });
});
