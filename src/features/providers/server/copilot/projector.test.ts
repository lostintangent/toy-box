import { describe, expect, test } from "bun:test";
import type { SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";
import { homedir } from "node:os";
import type { JSONType } from "zod";
import { encodeSystemMessage } from "@sessions/model/systemMessages";
import { replaySessionHistory } from "@sessions/model/reducer";
import { createSdkEventProjector } from "@providers/server/copilot/projector";
import type { SessionEvent } from "@sessions/model";

function sdkEvent(event: unknown): SdkSessionEvent {
  return event as SdkSessionEvent;
}

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
const ARTIFACT_PATCH_TEXT = `*** Begin Patch
*** Add File: ${homedir()}/.toy-box/sessions/toy-box-session/artifacts/plan.md
+# Plan
*** End Patch`;

function modelChange(
  newModel: string,
  reasoningEffort?: string | null,
  contextTier?: string | null,
): SdkSessionEvent {
  return sdkEvent({
    type: "session.model_change",
    data: {
      newModel,
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(contextTier !== undefined ? { contextTier } : {}),
    },
  });
}

function titleChanged(title: string): SdkSessionEvent {
  return sdkEvent({
    type: "session.title_changed",
    data: { title },
  });
}

function toolExecutionStart(
  toolName: string,
  toolCallId: string,
  argumentsRecord: { [key: string]: JSONType } | string = {},
  extraData: Record<string, unknown> = {},
  options: { agentId?: string } = {},
): SdkSessionEvent {
  return sdkEvent({
    type: "tool.execution_start",
    ...(options.agentId ? { agentId: options.agentId } : {}),
    data: {
      toolName,
      toolCallId,
      arguments: argumentsRecord,
      ...extraData,
    },
  });
}

function toolExecutionProgress(toolCallId: string, progressMessage: string): SdkSessionEvent {
  return sdkEvent({
    type: "tool.execution_progress",
    data: {
      toolCallId,
      progressMessage,
    },
  });
}

function toolExecutionComplete(
  toolCallId: string,
  options: {
    success?: boolean;
    resultContent?: string;
    detailedContent?: string;
    errorMessage?: string;
    agentId?: string;
    parentToolCallId?: string;
  },
): SdkSessionEvent {
  return sdkEvent({
    type: "tool.execution_complete",
    ...(options.agentId ? { agentId: options.agentId } : {}),
    data: {
      toolCallId,
      success: options.success ?? true,
      ...(options.parentToolCallId ? { parentToolCallId: options.parentToolCallId } : {}),
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
  });
}

function subagentStarted(
  agentId: string,
  toolCallId: string,
  model = "claude-haiku-4.5",
): SdkSessionEvent {
  return sdkEvent({
    type: "subagent.started",
    agentId,
    data: {
      toolCallId,
      agentName: "explore",
      agentDisplayName: "Explore Agent",
      agentDescription: "Searches code.",
      model,
    },
  });
}

function userInputRequested(
  requestId: string,
  toolCallId: string,
  question: string,
  choices?: string[],
): SdkSessionEvent {
  return sdkEvent({
    type: "user_input.requested",
    data: {
      requestId,
      toolCallId,
      question,
      choices,
      allowFreeform: true,
    },
  });
}

function userInputCompleted(
  requestId: string,
  answer: string,
  wasFreeform: boolean,
): SdkSessionEvent {
  return sdkEvent({
    type: "user_input.completed",
    data: { requestId, answer, wasFreeform },
  });
}

function expectOmittedToolLifecycle(
  project: ReturnType<typeof createSdkEventProjector>,
  options: {
    toolName: string;
    toolCallId: string;
    argumentsRecord?: { [key: string]: JSONType } | string;
    startEvents?: SessionEvent[];
    completionSuccess?: boolean;
    completionResultContent?: string;
    completionErrorMessage?: string;
  },
) {
  expect(
    project(toolExecutionStart(options.toolName, options.toolCallId, options.argumentsRecord)),
  ).toEqual(options.startEvents ?? []);

  expect(project(toolExecutionProgress(options.toolCallId, "still omitted"))).toEqual([]);

  expect(
    project(
      toolExecutionComplete(options.toolCallId, {
        success: options.completionSuccess ?? true,
        resultContent: options.completionResultContent,
        errorMessage: options.completionErrorMessage,
      }),
    ),
  ).toEqual([]);
}

describe("projector", () => {
  // ── Streaming: the live event pipeline ────────────────────────────────

  describe("streaming: visible tool calls", () => {
    test("projects normal tool calls into visible tool lifecycle events", () => {
      const project = createSdkEventProjector("toy-box-session");
      const args = { filePath: "notes.md" };

      expect(project(toolExecutionStart("write_file", "tool-write", args))).toEqual([
        { type: "tool_start", toolName: "write_file", toolCallId: "tool-write", arguments: args },
      ]);
      // Progress events carry no canonical meaning (nothing downstream consumes
      // them) and project to nothing for visible and omitted tools alike.
      expect(project(toolExecutionProgress("tool-write", "Writing file"))).toEqual([]);
      expect(project(toolExecutionComplete("tool-write", { resultContent: "done" }))).toEqual([
        { type: "tool_end", toolCallId: "tool-write", success: true, result: "done" },
      ]);
    });

    test("native output images become attachments while model-only images do not", () => {
      const project = createSdkEventProjector("toy-box-session");
      const image = { type: "image", data: "aW1hZ2U=", mimeType: "image/png" };
      const complete = (toolCallId: string, result: object) =>
        sdkEvent({
          type: "tool.execution_complete",
          data: { toolCallId, success: true, result: { content: "Done", ...result } },
        });
      project(toolExecutionStart("image_generation", "tool-image", { prompt: "A red circle" }));
      project(toolExecutionStart("observe_screen", "tool-screen"));

      expect(
        project(complete("tool-image", { contents: [{ type: "text", text: "Done" }, image] })),
      ).toEqual([
        {
          type: "tool_end",
          toolCallId: "tool-image",
          success: true,
          result: "Done",
          attachments: [{ base64: "aW1hZ2U=", mimeType: "image/png" }],
        },
      ]);
      expect(project(complete("tool-screen", { binaryResultsForLlm: [image] }))).toEqual([
        { type: "tool_end", toolCallId: "tool-screen", success: true, result: "Done" },
      ]);
    });

    test("failed tool calls surface the error message as the result", () => {
      const project = createSdkEventProjector("toy-box-session");
      project(toolExecutionStart("bash", "tool-fail", { command: "exit 1" }));

      expect(
        project(
          toolExecutionComplete("tool-fail", { success: false, errorMessage: "command failed" }),
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
      const project = createSdkEventProjector("toy-box-session");

      expect(project(toolExecutionStart("apply_patch", "tool-patch", PATCH_TEXT))).toEqual([
        {
          type: "tool_start",
          toolName: "patch",
          toolCallId: "tool-patch",
          arguments: { patch: PATCH_TEXT },
        },
      ]);

      expect(
        project(
          toolExecutionComplete("tool-patch", {
            success: true,
            resultContent: "Modified 1 file(s)",
            detailedContent: PATCH_DIFF,
          }),
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

    test("keeps open_canvas visible and projects typed canvas-opened events", () => {
      const project = createSdkEventProjector("toy-box-session");
      const args = {
        extensionId: "user:documint",
        canvasId: "documint-markdown-agent",
        instanceId: "review-plan",
        input: {
          path: "/tmp/plan.md",
          title: "Review Plan",
        },
      };

      expect(project(toolExecutionStart("open_canvas", "tool-canvas", args))).toEqual([
        {
          type: "tool_start",
          toolName: "open_canvas",
          toolCallId: "tool-canvas",
          arguments: args,
        },
      ]);

      expect(
        project(
          toolExecutionComplete("tool-canvas", {
            resultContent: "Opened canvas",
          }),
        ),
      ).toEqual([
        {
          type: "tool_end",
          toolCallId: "tool-canvas",
          success: true,
          result: "Opened canvas",
          details: undefined,
        },
      ]);

      expect(
        project(
          sdkEvent({
            type: "session.canvas.opened",
            data: {
              canvasId: "documint-markdown-agent",
              extensionId: "user:documint",
              extensionName: "documint",
              input: {
                path: "/tmp/plan.md",
                title: "Review Plan",
              },
              instanceId: "review-plan",
              status: "session-state/plan.md",
              title: "Review Plan",
              url: "http://127.0.0.1:51460/?instanceId=review-plan",
            },
          }),
        ),
      ).toEqual([
        {
          type: "canvas_opened",
          canvas: {
            canvasId: "documint-markdown-agent",
            extensionId: "user:documint",
            extensionName: "documint",
            input: {
              path: "/tmp/plan.md",
              title: "Review Plan",
            },
            instanceId: "review-plan",
            status: "session-state/plan.md",
            title: "Review Plan",
            url: "http://127.0.0.1:51460/?instanceId=review-plan",
          },
        },
      ]);
    });

    test("drops canvas-opened events without a renderable URL", () => {
      const project = createSdkEventProjector("toy-box-session");
      expect(
        project(
          sdkEvent({
            type: "session.canvas.opened",
            data: {
              canvasId: "documint-markdown-agent",
              extensionId: "user:documint",
              instanceId: "review-plan",
              title: "Review Plan",
            },
          }),
        ),
      ).toEqual([]);
    });
  });

  describe("streaming: user questions", () => {
    test("projects a live question and suppresses duplicate durable resolution", () => {
      const project = createSdkEventProjector("toy-box-session");
      const question = "Which database should I use?";
      const choices = ["SQLite", "PostgreSQL"];

      expect(project(toolExecutionStart("ask_user", "question-1", { question, choices }))).toEqual([
        {
          type: "tool_start",
          toolName: "ask_user",
          toolCallId: "question-1",
          arguments: { question, choices },
          question: { question, choices, allowFreeform: true },
        },
      ]);

      expect(project(userInputRequested("request-1", "question-1", question, choices))).toEqual([
        {
          type: "question_requested",
          toolCallId: "question-1",
          requestId: "request-1",
          question: { question, choices, allowFreeform: true },
        },
      ]);

      expect(project(userInputCompleted("request-1", "SQLite", false))).toEqual([
        {
          type: "question_resolved",
          toolCallId: "question-1",
          answer: "SQLite",
        },
      ]);

      expect(
        project(
          toolExecutionComplete("question-1", {
            resultContent: "User selected: SQLite",
          }),
        ),
      ).toEqual([
        {
          type: "tool_end",
          toolCallId: "question-1",
          success: true,
          result: "User selected: SQLite",
          details: undefined,
        },
      ]);
    });

    test("reconstructs selected and freeform answers from durable tool completion", () => {
      for (const [toolCallId, result, answer] of [
        ["question-choice", "User selected: SQLite", "SQLite"],
        ["question-freeform", "User responded: Deploy after 5 PM", "Deploy after 5 PM"],
      ] as const) {
        const project = createSdkEventProjector("toy-box-session");
        project(
          toolExecutionStart("ask_user", toolCallId, {
            question: "How should I proceed?",
            choices: ["SQLite"],
          }),
        );

        expect(project(toolExecutionComplete(toolCallId, { resultContent: result }))).toEqual([
          {
            type: "question_resolved",
            toolCallId,
            answer,
          },
          {
            type: "tool_end",
            toolCallId,
            success: true,
            result,
            details: undefined,
          },
        ]);
      }
    });
  });

  describe("streaming: subagents", () => {
    test("nests native subagent replies and work beneath the spawning agent call", () => {
      const project = createSdkEventProjector("toy-box-session");
      const nativeAgentId = "native-agent-9";
      const parentToolCallId = "call-task-9";
      const state = replaySessionHistory(
        [
          toolExecutionStart("task", parentToolCallId, { description: "Inspect the reducer" }),
          subagentStarted(nativeAgentId, parentToolCallId),
          sdkEvent({
            type: "assistant.message",
            agentId: nativeAgentId,
            data: { content: "Ownership returned to parent." },
          }),
          toolExecutionStart("view", "sub-1", { path: "a.ts" }, {}, { agentId: nativeAgentId }),
          toolExecutionStart("bash", "sub-2", { command: "pwd" }, {}, { agentId: nativeAgentId }),
          sdkEvent({
            type: "tool.shell_output",
            agentId: nativeAgentId,
            ephemeral: true,
            data: { toolCallId: "sub-2", sequence: 0, text: "/tmp\n" },
          }),
        ].flatMap(project),
      );

      expect(state.messages[0]).toMatchObject({
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: parentToolCallId,
            subagent: {
              model: { name: "claude-haiku-4.5" },
              content: "Ownership returned to parent.",
              toolCalls: [
                { id: "sub-1", name: "read" },
                { id: "sub-2", output: "/tmp\n" },
              ],
            },
          },
        ],
      });
    });

    test("background agent calls suppress the early tool_end and complete via subagent.completed", () => {
      const project = createSdkEventProjector("toy-box-session");

      expect(
        project(
          toolExecutionStart("task", "call-bg-1", { agentName: "explore", mode: "background" }),
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
        project(
          toolExecutionComplete("call-bg-1", {
            success: true,
            resultContent: "Agent started in background",
          }),
        ),
      ).toEqual([]);

      // The real completion signal arrives via subagent.completed.
      expect(
        project(sdkEvent({ type: "subagent.completed", data: { toolCallId: "call-bg-1" } })),
      ).toEqual([{ type: "tool_end", toolCallId: "call-bg-1", success: true }]);
    });

    test("failed background agents emit a failed tool_end via subagent.failed", () => {
      const project = createSdkEventProjector("toy-box-session");
      project(toolExecutionStart("task", "call-bg-2", { mode: "background" }));
      project(toolExecutionComplete("call-bg-2", { success: true }));

      expect(
        project(sdkEvent({ type: "subagent.failed", data: { toolCallId: "call-bg-2" } })),
      ).toEqual([{ type: "tool_end", toolCallId: "call-bg-2", success: false }]);
    });
  });

  describe("streaming: omitted and translated tools", () => {
    test("resolves Sessions tool policies through Copilot's tool aliases", () => {
      const project = createSdkEventProjector("toy-box-session");
      const path = "~/.toy-box/sessions/toy-box-session/artifacts/report.md";

      expect(project(toolExecutionStart("view", "tool-view", { path }))).toEqual([]);
      expect(project(toolExecutionStart("str_replace", "tool-edit", { path }))).toEqual([]);
      expect(project(toolExecutionStart("apply_patch", "tool-patch", ARTIFACT_PATCH_TEXT))).toEqual(
        [],
      );
      expect(project(toolExecutionStart("view", "tool-read", { path: "/tmp/report.md" }))).toEqual([
        {
          type: "tool_start",
          toolName: "read",
          toolCallId: "tool-read",
          arguments: { path: "/tmp/report.md" },
        },
      ]);
    });

    test("omitted tools stay hidden through progress and completion, even when they fail", () => {
      expectOmittedToolLifecycle(createSdkEventProjector("toy-box-session"), {
        toolName: "read_agent",
        toolCallId: "tool-read-agent",
        completionSuccess: false,
        completionErrorMessage: "boom",
      });
    });

    test("tools translated on start publish their events and are otherwise hidden", () => {
      expectOmittedToolLifecycle(createSdkEventProjector("toy-box-session"), {
        toolName: "open_session",
        toolCallId: "tool-open-session",
        argumentsRecord: { sessionId: "toy-box-linked-1" },
        startEvents: [{ type: "linked_session_added", sessionId: "toy-box-linked-1" }],
        completionResultContent: "Session toy-box-linked-1 opened.",
      });
    });

    test("tools translated on completion publish their events only once they complete", () => {
      const project = createSdkEventProjector("toy-box-session");

      expect(
        project(
          toolExecutionStart("create_session", "tool-create-session", {
            prompt: "Start a visible investigation",
            open: true,
          }),
        ),
      ).toEqual([]);
      expect(
        project(
          toolExecutionComplete("tool-create-session", {
            resultContent: JSON.stringify({ sessionId: "toy-box-created-1", opened: true }),
          }),
        ),
      ).toEqual([{ type: "linked_session_added", sessionId: "toy-box-created-1" }]);
    });
  });

  describe("streaming: todo SQL", () => {
    test("sql mutations publish todo patches on start and keep them when the call fails", () => {
      expectOmittedToolLifecycle(createSdkEventProjector("toy-box-session"), {
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
        completionSuccess: false,
        completionErrorMessage: "boom",
      });
    });

    test("sql reads of todo tables are omitted without publishing todo patches", () => {
      expectOmittedToolLifecycle(createSdkEventProjector("toy-box-session"), {
        toolName: "sql",
        toolCallId: "tool-select",
        argumentsRecord: { query: "SELECT id, title, status FROM todos;" },
        completionResultContent: "3 row(s) returned.",
      });
    });
  });

  describe("streaming: deltas", () => {
    test("appends live shell output to its running command", () => {
      const shellOutput = sdkEvent({
        type: "tool.shell_output",
        ephemeral: true,
        data: { toolCallId: "call-bash", sequence: 0, text: "12 pass\n" },
      });

      expect(createSdkEventProjector("toy-box-session")(shellOutput)).toEqual([
        { type: "tool_output_delta", toolCallId: "call-bash", content: "12 pass\n" },
      ]);
    });

    test("reasoning-only completions do not separate a streamed preview from its final message", () => {
      const history = [
        sdkEvent({
          type: "assistant.message",
          data: { messageId: "reasoning", content: "" },
        }),
        sdkEvent({
          type: "assistant.message",
          data: { messageId: "answer", content: "Done." },
        }),
      ];
      const live = [
        sdkEvent({
          type: "assistant.message_delta",
          data: { messageId: "answer", deltaContent: "Done." },
        }),
        ...history,
      ];
      const replay = (events: SdkSessionEvent[]) =>
        replaySessionHistory(events.flatMap(createSdkEventProjector("toy-box-session"))).messages;
      expect(replay(live)).toEqual([{ role: "assistant", messageId: "answer", content: "Done." }]);
      expect(replay(history)).toEqual(replay(live));
    });

    test("projects committed user and assistant messages", () => {
      const project = createSdkEventProjector("toy-box-session");

      expect(
        project(
          sdkEvent({
            type: "user.message",
            timestamp: "2026-01-01T00:00:00.000Z",
            data: {
              content: "What is in this image?",
              attachments: [
                { type: "file", displayName: "legacy.png", path: "/tmp/legacy.png" },
                { type: "blob", data: "aW1hZ2U=", mimeType: "image/png", displayName: "image.png" },
                {
                  type: "blob",
                  assetId: "sha256:asset-backed",
                  mimeType: "image/png",
                  displayName: "asset-backed.png",
                },
              ],
            },
          }),
        ),
      ).toEqual([
        {
          type: "user_message",
          content: "What is in this image?",
          timestamp: "2026-01-01T00:00:00.000Z",
          attachments: [{ base64: "aW1hZ2U=", mimeType: "image/png" }],
        },
      ]);

      expect(
        project(
          sdkEvent({
            type: "assistant.message",
            data: { content: "Root response", messageId: "root" },
          }),
        ),
      ).toEqual([{ type: "assistant_message", content: "Root response", messageId: "root" }]);

      expect(
        project(
          sdkEvent({
            type: "assistant.message",
            data: {
              messageId: "tools",
              content: "",
              toolRequests: [
                { toolCallId: "read", name: "view", arguments: { path: "README.md" } },
              ],
            },
          }),
        ),
      ).toEqual([{ type: "assistant_message", content: "", messageId: "tools" }]);

      expect(
        project(
          sdkEvent({
            type: "assistant.message",
            agentId: "native-agent-1",
            data: { content: "Agent response", parentToolCallId: "call-agent-1" },
          }),
        ),
      ).toEqual([
        {
          type: "assistant_message",
          parentToolCallId: "call-agent-1",
          content: "Agent response",
        },
      ]);
    });

    test("drops agent-scoped user messages", () => {
      expect(
        createSdkEventProjector("toy-box-session")(
          sdkEvent({
            type: "user.message",
            agentId: "call-agent-1",
            data: { content: "Agent prompt" },
          }),
        ),
      ).toEqual([]);
    });

    test("drops user messages from the system source", () => {
      expect(
        createSdkEventProjector("toy-box-session")(
          sdkEvent({
            type: "user.message",
            data: {
              content: "",
              transformedContent: "<system_reminder>Model-only context</system_reminder>",
              source: "system",
              delivery: "steering",
            },
          }),
        ),
      ).toEqual([]);
    });

    test("drops user messages from skill sources without parsing their content", () => {
      expect(
        createSdkEventProjector("toy-box-session")(
          sdkEvent({
            type: "user.message",
            data: {
              content: "Plan instructions",
              source: "skill-plan",
            },
          }),
        ),
      ).toEqual([]);
    });

    test("projects invoked skills as completed calls containing the skill path", () => {
      expect(
        createSdkEventProjector("toy-box-session")(
          sdkEvent({
            type: "skill.invoked",
            id: "skill-event-1",
            data: {
              name: "review",
              path: "/repo/.agents/skills/review/SKILL.md",
              content: "Review instructions",
              trigger: "agent-invoked",
            },
          }),
        ),
      ).toEqual([
        {
          type: "tool_start",
          toolName: "skill",
          toolCallId: "skill-event-1",
          arguments: {
            skill: "review",
            path: "/repo/.agents/skills/review/SKILL.md",
          },
        },
        {
          type: "tool_end",
          toolCallId: "skill-event-1",
          success: true,
        },
      ]);
    });

    test("keeps context-loaded skills out of the transcript", () => {
      expect(
        createSdkEventProjector("toy-box-session")(
          sdkEvent({
            type: "skill.invoked",
            id: "skill-event-1",
            data: {
              name: "review",
              path: "/repo/.agents/skills/review/SKILL.md",
              content: "Review instructions",
              trigger: "context-load",
            },
          }),
        ),
      ).toEqual([]);
    });

    test("does not expose SDK delivery bookkeeping on canonical user messages", () => {
      const project = createSdkEventProjector("toy-box-session");
      const deliveries = (["idle", "steering", "queued"] as const).map(
        (delivery) =>
          project(sdkEvent({ type: "user.message", data: { content: delivery, delivery } }))[0],
      );

      expect(deliveries).toEqual([
        { type: "user_message", content: "idle", attachments: undefined, timestamp: undefined },
        { type: "user_message", content: "steering", attachments: undefined, timestamp: undefined },
        { type: "user_message", content: "queued", attachments: undefined, timestamp: undefined },
      ]);
    });

    test("decodes system messages at the SDK boundary", () => {
      const content = encodeSystemMessage({
        type: "file_edited",
        file: { kind: "session", sessionId: "session-1", path: "plan.md" },
      });

      expect(
        createSdkEventProjector("toy-box-session")(
          sdkEvent({
            type: "user.message",
            timestamp: "2026-01-01T00:00:00.000Z",
            data: {
              content,
              source: "system",
              delivery: "steering",
            },
          }),
        ),
      ).toEqual([
        {
          type: "system_message",
          content: {
            type: "file_edited",
            file: { kind: "session", sessionId: "session-1", path: "plan.md" },
          },
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ]);
    });

    test("drops empty-content deltas at the source", () => {
      const project = createSdkEventProjector("toy-box-session");

      expect(
        project(sdkEvent({ type: "assistant.message_delta", data: { deltaContent: "" } })),
      ).toEqual([]);
      expect(
        project(sdkEvent({ type: "assistant.reasoning_delta", data: { deltaContent: "" } })),
      ).toEqual([]);

      expect(
        project(
          sdkEvent({
            type: "assistant.message_delta",
            data: { deltaContent: "Hi", messageId: "root" },
          }),
        ),
      ).toEqual([{ type: "delta", content: "Hi", messageId: "root" }]);
      expect(
        project(sdkEvent({ type: "assistant.reasoning_delta", data: { deltaContent: "Hmm" } })),
      ).toEqual([{ type: "reasoning_delta", content: "Hmm" }]);
    });

    test("drops transient subagent text deltas", () => {
      const project = createSdkEventProjector("toy-box-session");

      expect(
        project(
          sdkEvent({
            type: "assistant.message_delta",
            agentId: "native-agent-1",
            data: { deltaContent: "Subagent text" },
          }),
        ),
      ).toEqual([]);
    });

    test("subagent reasoning previews each turn beneath its agent call and converges with history", () => {
      const agentId = "native-agent-1";
      const parentToolCallId = "call-agent-1";
      const reasoningDelta = (deltaContent: string) =>
        sdkEvent({ type: "assistant.reasoning_delta", agentId, data: { deltaContent } });
      const turnStart = sdkEvent({ type: "assistant.turn_start", agentId, data: {} });
      const reply = (reasoningText: string) =>
        sdkEvent({
          type: "assistant.message",
          agentId,
          data: { content: "", reasoningText, toolRequests: [{ toolCallId: "t", name: "view" }] },
        });
      const subagentReasoning = (events: SdkSessionEvent[]) => {
        const project = createSdkEventProjector("toy-box-session");
        const state = replaySessionHistory(
          [
            toolExecutionStart("task", parentToolCallId, { description: "Inspect" }),
            subagentStarted(agentId, parentToolCallId),
            ...events,
          ].flatMap(project),
        );
        expect(state.reasoningContent).toBe("");
        const [message] = state.messages;
        return message?.role === "assistant"
          ? message.toolCalls?.[0]?.subagent?.reasoningContent
          : undefined;
      };

      expect(subagentReasoning([turnStart, reasoningDelta("Read"), reasoningDelta("ing")])).toBe(
        "Reading",
      );
      expect(
        subagentReasoning([
          turnStart,
          reasoningDelta("Read"),
          reply("Reading the file"),
          turnStart,
          reasoningDelta("Check"),
        ]),
      ).toBe("Check");

      // Deltas are ephemeral, so history keeps only the reply's durable reasoning.
      const live = [turnStart, reasoningDelta("Read"), reply("Reading the file")];
      const history = live.filter((event) => event.type !== "assistant.reasoning_delta");
      expect(subagentReasoning(live)).toBe("Reading the file");
      expect(subagentReasoning(history)).toBe("Reading the file");
    });
  });

  describe("streaming: session events", () => {
    test("reports only the root agent's context usage", () => {
      const project = createSdkEventProjector("toy-box-session");
      const usageInfo = (agentId?: string) =>
        sdkEvent({
          type: "session.usage_info",
          ...(agentId ? { agentId } : {}),
          ephemeral: true,
          data: { currentTokens: 41_000, tokenLimit: 200_000, messagesLength: 12 },
        });

      expect(project(usageInfo())).toEqual([
        { type: "context_usage_changed", usage: { tokens: 41_000, tokenWindow: 200_000 } },
      ]);
      expect(project(usageInfo("native-agent-9"))).toEqual([]);
    });

    test("drops subagent status events so they do not mutate root status", () => {
      const project = createSdkEventProjector("toy-box-session");

      expect(project(sdkEvent({ type: "assistant.idle", data: {} }))).toEqual([
        { type: "status", status: "background" },
      ]);
      expect(
        project(sdkEvent({ type: "assistant.idle", agentId: "call-agent-1", data: {} })),
      ).toEqual([]);

      expect(project(sdkEvent({ type: "assistant.turn_start", data: {} }))).toEqual([
        { type: "status", status: "thinking" },
      ]);
      expect(
        project(sdkEvent({ type: "assistant.turn_start", agentId: "call-agent-1", data: {} })),
      ).toEqual([]);

      expect(project(sdkEvent({ type: "session.compaction_start", data: {} }))).toEqual([
        { type: "status", status: "compacting" },
      ]);
      expect(
        project(sdkEvent({ type: "session.compaction_start", agentId: "call-agent-1", data: {} })),
      ).toEqual([]);

      expect(project(sdkEvent({ type: "session.compaction_complete", data: {} }))).toEqual([
        { type: "status", status: "thinking" },
      ]);
      expect(
        project(
          sdkEvent({ type: "session.compaction_complete", agentId: "call-agent-1", data: {} }),
        ),
      ).toEqual([]);
    });

    test("projects native model, title, and failure transitions", () => {
      const project = createSdkEventProjector("toy-box-session");

      expect(
        project(
          sdkEvent({
            type: "session.start",
            data: {
              sessionId: "session-1",
              producer: "copilot-agent",
              copilotVersion: "1.0.61",
              startTime: "2026-06-10T20:29:43.232Z",
              selectedModel: "gpt-5.5",
              reasoningEffort: "xhigh",
              contextTier: "future_tier",
            },
          }),
        ),
      ).toEqual([
        {
          type: "model_changed",
          model: {
            provider: "copilot",
            name: "gpt-5.5",
            reasoningEffort: "xhigh",
            contextTier: "future_tier",
          },
        },
      ]);

      expect(
        project(
          sdkEvent({
            type: "session.resume",
            data: {
              resumeTime: "2026-06-10T20:29:44.232Z",
              eventCount: 10,
              selectedModel: "gpt-5.4-mini",
              reasoningEffort: "none",
            },
          }),
        ),
      ).toEqual([
        {
          type: "model_changed",
          model: { provider: "copilot", name: "gpt-5.4-mini", reasoningEffort: "none" },
        },
      ]);

      expect(project(modelChange("claude-sonnet-4.6"))).toEqual([
        { type: "model_changed", model: { provider: "copilot", name: "claude-sonnet-4.6" } },
      ]);

      expect(project(modelChange("gpt-5", "high", "future_tier"))).toEqual([
        {
          type: "model_changed",
          model: {
            provider: "copilot",
            name: "gpt-5",
            reasoningEffort: "high",
            contextTier: "future_tier",
          },
        },
      ]);

      expect(project(modelChange("gpt-5", null, null))).toEqual([
        {
          type: "model_changed",
          model: { provider: "copilot", name: "gpt-5" },
        },
      ]);

      expect(project(titleChanged("Friendly title"))).toEqual([
        { type: "session_title_changed", title: "Friendly title" },
      ]);
      expect(
        project(sdkEvent({ type: "session.handoff", data: { summary: "Compacted summary" } })),
      ).toEqual([{ type: "session_title_changed", title: "Compacted summary" }]);

      expect(
        project(
          sdkEvent({
            type: "session.error",
            data: { message: "Native model history is incompatible." },
          }),
        ),
      ).toEqual([{ type: "end", reason: "error", error: "Native model history is incompatible." }]);
    });

    test("projects subagent start model as a scoped model change", () => {
      const project = createSdkEventProjector("toy-box-session");

      expect(
        project(
          sdkEvent({
            type: "subagent.started",
            agentId: "native-agent-1",
            data: {
              toolCallId: "call-agent-1",
              agentName: "explore",
              agentDisplayName: "Explore Agent",
              agentDescription: "Searches code.",
              model: "claude-haiku-4.5",
            },
          }),
        ),
      ).toEqual([
        {
          type: "model_changed",
          parentToolCallId: "call-agent-1",
          model: { provider: "copilot", name: "claude-haiku-4.5" },
        },
      ]);
    });

    test("returns no events for unknown SDK event types", () => {
      expect(
        createSdkEventProjector("toy-box-session")(sdkEvent({ type: "unknown.event", data: {} })),
      ).toEqual([]);
    });
  });
});

// Golden replays of real session fixtures live in tests/ (see tests/AGENTS.md).
