// Copilot SDK adapter that projects raw SDK events into canonical
// SessionEvents. This module owns all SDK-specific projection policy for
// live event streams; history replay adapts persisted logs onto this same
// projection in provider.readHistory().

import type { SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";
import type { JSONType } from "zod";
import type { SessionEvent, SessionQuestionBase, ToolCall } from "@sessions/model";
import type { Attachment } from "@/shared/attachments/model";
import { decodeSystemMessage } from "@sessions/model/systemMessages";
import { fromSdkAttachments } from "./attachments";
import { parseTodoSql } from "./todoParser";
type ToolArguments = ToolCall["arguments"];

// ============================================================================
// Tool name aliases
// ============================================================================

// Normalize tool name aliases to canonical names so the UI only needs one name per tool.
const TOOL_NAME_ALIASES: Record<string, string> = {
  view: "read",
  rg: "grep",
  str_replace: "edit",
  apply_patch: "patch",
  web_fetch: "fetch",
  task: "agent",
};

// ============================================================================
// Types
// ============================================================================

type SdkQuestion = Pick<
  Extract<SdkSessionEvent, { type: "user_input.requested" }>["data"],
  "question" | "choices" | "allowFreeform"
>;

// Hidden calls never reach the transcript. A deferred call completes from a
// later SDK event instead of its own tool completion.
type ToolCallPolicy = "hidden" | "deferred";

type ProjectionState = {
  toolCallPolicies: Map<string, ToolCallPolicy>;
  subagentParents: Map<string, string>;
  binaryAssets: Map<string, Attachment>;
  questionToolCall?: {
    toolCallId: string;
    requestId?: string;
  };
};

// ============================================================================
// Public API
// ============================================================================

/** Create one stateful SDK → domain projector for a session. Tool lifecycle
 *  correlation stays private to the returned function. */
export function createSdkEventProjector() {
  const state: ProjectionState = {
    toolCallPolicies: new Map(),
    subagentParents: new Map(),
    binaryAssets: new Map(),
  };
  return (event: SdkSessionEvent): SessionEvent[] => projectSdkEvent(event, state);
}

/** Map a single SDK event to canonical SessionEvents. */
function projectSdkEvent(event: SdkSessionEvent, state: ProjectionState): SessionEvent[] {
  switch (event.type) {
    case "session.binary_asset":
      state.binaryAssets.set(event.data.assetId, {
        base64: event.data.data,
        mimeType: event.data.mimeType,
      });
      return [];
    case "user.message":
      // Subagent prompts are not root user turns — they're already visible as
      // the agent tool call's arguments.
      if (event.agentId) return [];

      // Skill loading uses synthetic user messages to give the agent access to the selected skill.
      if (event.data.source?.startsWith("skill-")) return [];

      const systemMessage = decodeSystemMessage(event.data.content);
      // Toy Box sends each input's client ID as its native turn ID, so live and replay correlate.
      const clientId = event.data.clientTurnId;
      if (systemMessage) {
        return [
          {
            type: "system_message",
            content: systemMessage,
            ...(clientId ? { clientId } : {}),
            timestamp: event.timestamp,
          },
        ];
      }

      // System reminders are model-only context, not user-visible transcript messages.
      if (event.data.source === "system") return [];

      return [
        {
          type: "user_message",
          content: event.data.content,
          ...(clientId ? { clientId } : {}),
          timestamp: event.timestamp,
          attachments: fromSdkAttachments(event.data.attachments, state.binaryAssets),
        },
      ];
    case "assistant.message": {
      const parentToolCallId = resolveParentToolCallId(
        event.agentId,
        event.data.parentToolCallId,
        state,
      );
      if (event.agentId && !parentToolCallId) return [];
      // Subagent reasoning stays on its agent call, so durable text replaces the live preview.
      const reasoning: SessionEvent[] =
        parentToolCallId && event.data.reasoningText
          ? [{ type: "reasoning", content: event.data.reasoningText, parentToolCallId }]
          : [];
      // Reasoning-only messages can arrive between another message's deltas and completion.
      if (!event.data.content && !event.data.toolRequests?.length) return reasoning;
      return [
        ...reasoning,
        {
          type: "assistant_message",
          ...(parentToolCallId ? { parentToolCallId } : {}),
          ...(!event.agentId && event.data.messageId ? { messageId: event.data.messageId } : {}),
          content: event.data.content,
        },
      ];
    }
    // Empty-content deltas are dropped at the source: they carry nothing, and
    // downstream consumers (reducer message fragmentation, stream buffering)
    // should never have to guard against them.
    case "assistant.message_delta": {
      // TODO: Route sub-agent deltas into their parent agent tool call once the
      // agent tool UI can render live child assistant output.
      if (event.agentId) return [];
      const { deltaContent: content, messageId } = event.data;
      return content ? [{ type: "delta", content, ...(messageId ? { messageId } : {}) }] : [];
    }
    case "assistant.reasoning_delta": {
      const content = event.data.deltaContent;
      if (!content) return [];
      if (!event.agentId) return [{ type: "reasoning_delta", content }];
      const parentToolCallId = resolveParentToolCallId(event.agentId, undefined, state);
      return parentToolCallId ? [{ type: "reasoning_delta", content, parentToolCallId }] : [];
    }
    case "skill.invoked": {
      if (event.data.trigger === "context-load" || event.agentId) return [];

      const toolCallId = event.id;
      return [
        {
          type: "tool_start",
          toolName: "skill",
          toolCallId,
          arguments: {
            skill: event.data.name,
            path: event.data.path,
          },
        },
        {
          type: "tool_end",
          toolCallId,
          success: true,
        },
      ];
    }
    case "assistant.turn_start": {
      if (!event.agentId) return [{ type: "status", status: "thinking" }];
      // Each subagent turn starts a new reasoning preview on its agent call.
      const parentToolCallId = resolveParentToolCallId(
        event.agentId,
        event.data.parentToolCallId,
        state,
      );
      return parentToolCallId ? [{ type: "reasoning", content: "", parentToolCallId }] : [];
    }
    case "model.call_failure":
      // The CLI backs off and retries a failed root call, or ends the turn with session.error.
      return event.data.source === "top_level" ? [{ type: "status", status: "retrying" }] : [];
    case "assistant.idle":
      return event.agentId ? [] : [{ type: "status", status: "background" }];
    case "session.compaction_complete":
      return event.agentId ? [] : [{ type: "status", status: "thinking" }];
    case "session.compaction_start":
      return event.agentId ? [] : [{ type: "status", status: "compacting" }];
    case "session.usage_info": {
      const { currentTokens: tokens, tokenLimit: tokenWindow } = event.data;
      return event.agentId
        ? []
        : [{ type: "context_usage_changed", usage: { tokens, tokenWindow } }];
    }
    case "session.error":
      return event.agentId ? [] : [{ type: "end", reason: "error", error: event.data.message }];
    case "session.start":
    case "session.resume":
      return projectModel(
        event.data.selectedModel,
        event.data.reasoningEffort,
        event.data.contextTier,
      );
    case "session.model_change":
      return projectModel(event.data.newModel, event.data.reasoningEffort, event.data.contextTier);
    case "session.title_changed":
      return [{ type: "session_title_changed", title: event.data.title }];
    case "session.handoff":
      return event.data.summary
        ? [{ type: "session_title_changed", title: event.data.summary }]
        : [];
    case "session.canvas.opened": {
      if (!event.data.url) return [];

      const input = event.data.input as JSONType | undefined;
      const title = event.data.title ?? readCanvasInputTitle(input) ?? event.data.canvasId;

      return [
        {
          type: "canvas_opened",
          canvas: {
            canvasId: event.data.canvasId,
            instanceId: event.data.instanceId,
            url: event.data.url,
            title,
            extensionId: event.data.extensionId,
            ...(event.data.extensionName ? { extensionName: event.data.extensionName } : {}),
            ...(event.data.status ? { status: event.data.status } : {}),
            ...(input !== undefined ? { input } : {}),
          },
        },
      ];
    }
    case "subagent.started": {
      const parentToolCallId = event.data.toolCallId;
      if (event.agentId) state.subagentParents.set(event.agentId, parentToolCallId);
      const model = event.data.model;
      return model
        ? [{ type: "model_changed", parentToolCallId, model: { provider: "copilot", name: model } }]
        : [];
    }
    case "subagent.completed":
    case "subagent.failed": {
      const { toolCallId } = event.data;
      if (event.agentId) state.subagentParents.delete(event.agentId);
      if (state.toolCallPolicies.get(toolCallId) !== "deferred") return [];

      const success = event.type === "subagent.completed";
      state.toolCallPolicies.delete(toolCallId);
      return [{ type: "tool_end", toolCallId, success }];
    }
    case "tool.execution_start": {
      const rawToolName = event.data.toolName;
      const toolName = TOOL_NAME_ALIASES[rawToolName] ?? rawToolName;
      const args = readToolArguments(rawToolName, event.data.arguments);
      const toolCallId = event.data.toolCallId;
      const parentToolCallId = resolveParentToolCallId(
        event.agentId,
        event.data.parentToolCallId,
        state,
      );
      if (event.agentId && !parentToolCallId) return [];
      // A SQL call that only edits the todo list becomes todo patches instead of a tool call.
      const todoPatches =
        toolName === "sql" && typeof args?.query === "string"
          ? parseTodoSql(args.query)
          : undefined;
      const policy = todoPatches ? "hidden" : resolveCopilotToolPolicy(toolName, args);
      const question =
        toolName === "ask_user" && !parentToolCallId
          ? toSessionQuestion(args as SdkQuestion)
          : undefined;

      if (policy) state.toolCallPolicies.set(toolCallId, policy);
      if (question) state.questionToolCall = { toolCallId };
      if (policy === "hidden")
        return todoPatches?.length ? [{ type: "todos_patch", patches: todoPatches }] : [];

      return [
        {
          type: "tool_start",
          toolName,
          toolCallId,
          ...(parentToolCallId ? { parentToolCallId } : {}),
          arguments: args,
          ...(question ? { question } : {}),
        },
      ];
    }
    case "tool.shell_output": {
      const { toolCallId, text: content } = event.data;
      if (!content) return [];
      if (!event.agentId) return [{ type: "tool_output_delta", toolCallId, content }];
      const parentToolCallId = resolveParentToolCallId(event.agentId, undefined, state);
      return parentToolCallId
        ? [{ type: "tool_output_delta", toolCallId, content, parentToolCallId }]
        : [];
    }
    case "tool.execution_complete": {
      const { data } = event;
      const { toolCallId } = data;
      const parentToolCallId = resolveParentToolCallId(event.agentId, data.parentToolCallId, state);
      if (event.agentId && !parentToolCallId) {
        state.toolCallPolicies.delete(toolCallId);
        return [];
      }
      const policy = state.toolCallPolicies.get(toolCallId);
      const result = data.result?.content ?? data.error?.message;
      // Live, the CLI repeats the content as details. History keeps only details that differ.
      const details =
        data.result?.detailedContent !== data.result?.content
          ? data.result?.detailedContent
          : undefined;
      const questionEvents = projectDurableQuestionResolution(toolCallId, result, state);

      if (policy === "hidden") {
        state.toolCallPolicies.delete(toolCallId);
        return questionEvents;
      }

      // Images in the tool's native output; model-only images in binaryResultsForLlm stay out.
      const attachments: Attachment[] = (data.result?.contents ?? []).flatMap((content) =>
        content.type === "image" ? [{ base64: content.data, mimeType: content.mimeType }] : [],
      );
      const toolEnd: SessionEvent = {
        type: "tool_end",
        toolCallId,
        ...(parentToolCallId ? { parentToolCallId } : {}),
        success: data.success,
        result,
        details,
        ...(attachments.length ? { attachments } : {}),
      };

      // Background tool calls can have a non-authoritative SDK completion event.
      // Skip it when another declared SDK event is the real completion source.
      if (policy === "deferred") return questionEvents;

      return [...questionEvents, toolEnd];
    }
    case "user_input.requested": {
      const toolCallId = event.data.toolCallId;
      if (!toolCallId || event.agentId) return [];

      state.questionToolCall = {
        toolCallId,
        requestId: event.data.requestId,
      };

      return [
        {
          type: "question_requested",
          toolCallId,
          requestId: event.data.requestId,
          question: toSessionQuestion(event.data),
        },
      ];
    }
    case "user_input.completed": {
      if (event.agentId) return [];
      if (state.questionToolCall?.requestId !== event.data.requestId) return [];
      if (event.data.answer === undefined) return [];

      const { toolCallId } = state.questionToolCall;
      state.questionToolCall = undefined;
      return [
        {
          type: "question_resolved",
          toolCallId,
          answer: event.data.answer,
        },
      ];
    }
    default:
      return [];
  }
}

function resolveParentToolCallId(
  agentId: string | undefined,
  nativeParentToolCallId: string | undefined,
  state: ProjectionState,
) {
  return nativeParentToolCallId ?? (agentId ? state.subagentParents.get(agentId) : undefined);
}

// ============================================================================
// Tool call policy
// ============================================================================

// The CLI's own bookkeeping, which the transcript shows another way or not at
// all. Skill loads appear through skill.invoked.
const HIDDEN_TOOLS = new Set(["skill", "read_agent", "write_agent", "list_agents"]);

/** Decide how a native tool call projects from its canonical name, so the
 *  SDK's "task" resolves the "agent" policy. Background agents complete from
 *  their subagent event. Sessions applies Toy Box tools' policy downstream. */
function resolveCopilotToolPolicy(
  toolName: string,
  args: ToolArguments,
): ToolCallPolicy | undefined {
  if (HIDDEN_TOOLS.has(toolName)) return "hidden";
  if (toolName === "agent" && args?.mode === "background") return "deferred";
  return undefined;
}

// ============================================================================
// Projection helpers
// ============================================================================

function projectModel(
  model: string | undefined,
  reasoningEffort: string | null | undefined,
  contextTier: string | null | undefined,
): SessionEvent[] {
  return model
    ? [
        {
          type: "model_changed",
          model: {
            provider: "copilot",
            name: model,
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(contextTier != null ? { contextTier } : {}),
          },
        },
      ]
    : [];
}

function toSessionQuestion(question: SdkQuestion): SessionQuestionBase {
  return {
    question: question.question,
    ...(question.choices?.length ? { choices: question.choices } : {}),
    allowFreeform: question.allowFreeform ?? true,
  };
}

function projectDurableQuestionResolution(
  toolCallId: string,
  result: string | undefined,
  state: ProjectionState,
): SessionEvent[] {
  if (state.questionToolCall?.toolCallId !== toolCallId) return [];

  state.questionToolCall = undefined;

  const answer = result?.match(/^User (?:selected|responded): ([\s\S]*)/)?.[1];
  if (!answer) return [];

  return [
    {
      type: "question_resolved",
      toolCallId,
      answer,
    },
  ];
}

// ============================================================================
// Field readers
// ============================================================================

function readCanvasInputTitle(input: JSONType | undefined): string | undefined {
  return input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    typeof input.title === "string"
    ? input.title
    : undefined;
}

// Arguments are records, except that apply_patch sends its patch body as a bare string.
function readToolArguments(rawToolName: string, rawArguments: unknown): ToolArguments {
  if (rawArguments && typeof rawArguments === "object" && !Array.isArray(rawArguments)) {
    return rawArguments as ToolArguments;
  }
  return rawToolName === "apply_patch" && typeof rawArguments === "string"
    ? { patch: rawArguments }
    : {};
}
