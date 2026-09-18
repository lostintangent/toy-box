// Copilot SDK adapter that projects raw SDK events into canonical
// SessionEvents. This module owns all SDK-specific projection policy for
// live event streams; history replay adapts persisted logs onto this same
// projection in provider.readHistory().
//
// The file reads top-down: policy tables (tool name aliases, argument-shape
// adapters, turn-end reasons, per-tool projection policies),
// then types and public entry points, then event projection, policy factories,
// and the small field adapters needed at tool-argument boundaries.

import type {
  SessionEvent as SdkSessionEvent,
  ToolExecutionCompleteData,
} from "@github/copilot-sdk";
import type { JSONType } from "zod";
import type { Attachment, SessionEvent, SessionQuestionBase, ToolCall } from "@sessions/model";
import { decodeSystemMessage } from "@sessions/model/systemMessages";
import { fromSdkAttachments } from "./attachments";
import {
  resolveToolCallPolicy,
  type ToolCallProjectionPolicy as SharedToolCallProjectionPolicy,
} from "@sessions/server/toolProjection";
import { parseTodoSql } from "./todoParser";
type ToolCallProjectionPolicy = SharedToolCallProjectionPolicy | { kind: "deferred" };
type ToolArguments = ToolCall["arguments"];

// ============================================================================
// Policy
// ============================================================================

// Normalize tool name aliases to canonical names so the UI only needs one name per tool.
const TOOL_NAME_ALIASES: Record<string, string> = {
  run_in_terminal: "bash",
  execute_command: "bash",
  read_file: "read",
  view: "read",
  file_search: "glob",
  grep_search: "grep",
  search: "grep",
  rg: "grep",
  replace_string_in_file: "edit",
  apply_patch: "patch",
  web_fetch: "fetch",
  fetch_webpage: "fetch",
  task: "agent",
};

// Tools whose raw arguments arrive in a non-record shape, keyed by RAW SDK
// name (argument reading happens before alias normalization).
const TOOL_ARGUMENT_ADAPTERS: Record<string, ((raw: unknown) => ToolArguments) | undefined> = {
  // apply_patch sends the patch body as a bare string.
  apply_patch: (raw): ToolArguments => (typeof raw === "string" ? { patch: raw } : {}),
};

// ============================================================================
// Types
// ============================================================================

type SdkQuestion = Pick<
  Extract<SdkSessionEvent, { type: "user_input.requested" }>["data"],
  "question" | "choices" | "allowFreeform"
>;

type ProjectionState = {
  sessionId: string;
  toolCallPolicies: Map<string, ToolCallProjectionPolicy>;
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
export function createSdkEventProjector(sessionId: string) {
  const state: ProjectionState = {
    sessionId,
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
    // Empty-content deltas are dropped at the source: they carry nothing, and
    // downstream consumers (reducer message fragmentation, stream buffering)
    // should never have to guard against them.
    case "user.message":
      // Subagent prompts are not root user turns — they're already visible as
      // the agent tool call's arguments.
      if (event.agentId) return [];

      // System reminders are model-only context, not user-visible transcript messages.
      if (event.data.source === "system") return [];

      // Skill loading uses synthetic user messages to give the agent access to the selected skill.
      if (event.data.source?.startsWith("skill-")) return [];

      const systemMessage = decodeSystemMessage(event.data.content);
      if (systemMessage) {
        return [
          {
            type: "system_message",
            content: systemMessage,
            timestamp: event.timestamp,
          },
        ];
      }

      return [
        {
          type: "user_message",
          content: event.data.content,
          timestamp: event.timestamp,
          attachments: fromSdkAttachments(event.data.attachments, state.binaryAssets),
        },
      ];
    case "assistant.message": {
      // Reasoning-only messages can arrive between another message's deltas and completion.
      if (!event.data.content && !event.data.toolRequests?.length) return [];
      const parentToolCallId = resolveParentToolCallId(
        event.agentId,
        event.data.parentToolCallId,
        state,
      );
      if (event.agentId && !parentToolCallId) return [];
      return [
        {
          type: "assistant_message",
          ...(parentToolCallId ? { parentToolCallId } : {}),
          ...(!event.agentId && event.data.messageId ? { messageId: event.data.messageId } : {}),
          content: event.data.content,
        },
      ];
    }
    case "assistant.message_delta": {
      // TODO: Route sub-agent deltas into their parent agent tool call once the
      // agent tool UI can render live child assistant output.
      if (event.agentId) return [];
      const { deltaContent: content, messageId } = event.data;
      return content ? [{ type: "delta", content, ...(messageId ? { messageId } : {}) }] : [];
    }
    case "assistant.reasoning_delta": {
      // Like text deltas, transient subagent reasoning is omitted. Committed
      // replies and child tools carry their parent tool-call identity.
      if (event.agentId) return [];
      const content = event.data.deltaContent;
      return content ? [{ type: "reasoning", content }] : [];
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
    case "assistant.turn_start":
      return event.agentId ? [] : [{ type: "status", status: "thinking" }];
    case "session.compaction_complete":
      return event.agentId ? [] : [{ type: "status", status: "thinking" }];
    case "session.compaction_start":
      return event.agentId ? [] : [{ type: "status", status: "compacting" }];
    case "session.start":
      return projectSessionStart(
        event.data.selectedModel,
        event.data.reasoningEffort,
        event.data.contextTier,
      );
    case "session.model_change":
      return [
        {
          type: "model_changed",
          model: {
            provider: "copilot",
            name: event.data.newModel,
            ...(event.data.reasoningEffort ? { reasoningEffort: event.data.reasoningEffort } : {}),
            ...(event.data.contextTier != null ? { contextTier: event.data.contextTier } : {}),
          },
        },
      ];
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
      const policy = state.toolCallPolicies.get(toolCallId);
      if (policy?.kind !== "deferred") return [];

      const success = event.type === "subagent.completed";
      state.toolCallPolicies.delete(toolCallId);
      return [{ type: "tool_end", toolCallId, success }];
    }
    case "tool.execution_start": {
      const rawToolName = event.data.toolName;
      const toolName = normalizeToolName(rawToolName);
      const args = readToolArguments(rawToolName, event.data.arguments);
      const toolCallId = event.data.toolCallId;
      const parentToolCallId = resolveParentToolCallId(
        event.agentId,
        event.data.parentToolCallId,
        state,
      );
      if (event.agentId && !parentToolCallId) return [];
      const policy = resolveCopilotToolPolicy(toolName, args, state);
      const question =
        toolName === "ask_user" && !parentToolCallId
          ? toSessionQuestion(args as SdkQuestion)
          : undefined;

      if (policy) state.toolCallPolicies.set(toolCallId, policy);
      if (question) state.questionToolCall = { toolCallId };
      if (policy?.kind === "omitted") return [];
      if (policy?.kind === "translated") return policy.projectOnStart ?? [];

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
    case "tool.execution_complete": {
      const { data } = event;
      const { toolCallId } = data;
      const parentToolCallId = resolveParentToolCallId(event.agentId, data.parentToolCallId, state);
      if (event.agentId && !parentToolCallId) {
        state.toolCallPolicies.delete(toolCallId);
        return [];
      }
      const policy = state.toolCallPolicies.get(toolCallId);
      const result = readToolResultText(data);
      const questionEvents = projectDurableQuestionResolution(toolCallId, result, state);

      if (policy?.kind === "omitted") {
        state.toolCallPolicies.delete(toolCallId);
        return questionEvents;
      }

      if (policy?.kind === "translated") {
        state.toolCallPolicies.delete(toolCallId);
        return [
          ...questionEvents,
          ...(policy.projectOnComplete?.({
            success: data.success,
            result,
            details: data.result?.detailedContent,
          }) ?? []),
        ];
      }

      const toolEnd: SessionEvent = {
        type: "tool_end",
        toolCallId,
        ...(parentToolCallId ? { parentToolCallId } : {}),
        success: data.success,
        result,
        details: data.result?.detailedContent,
      };

      // Background tool calls can have a non-authoritative SDK completion event.
      // Skip it when another declared SDK event is the real completion source.
      if (policy?.kind === "deferred") return questionEvents;

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
// Tool call policy resolution
// ============================================================================

// Decide how a tool call projects from its CANONICAL name (post-
// TOOL_NAME_ALIASES, so e.g. the SDK's "task" resolves the "agent" policy),
// arguments, and projection state. Static policies live in TOOL_CALL_POLICIES;
// dynamic policies use arguments/state to build translated events or to detect
// tool calls completed by another lifecycle.
function projectSessionStart(
  model: string | undefined,
  reasoningEffort: string | undefined,
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

  const answer = readDurableQuestionAnswer(result);
  if (!answer) return [];

  return [
    {
      type: "question_resolved",
      toolCallId,
      answer,
    },
  ];
}

function readDurableQuestionAnswer(result: string | undefined): string | undefined {
  if (!result) return undefined;

  const selectedPrefix = "User selected: ";
  if (result.startsWith(selectedPrefix)) {
    return result.slice(selectedPrefix.length);
  }

  const respondedPrefix = "User responded: ";
  if (result.startsWith(respondedPrefix)) {
    return result.slice(respondedPrefix.length);
  }

  return undefined;
}

// ============================================================================
// Field readers
// ============================================================================

function normalizeToolName(name: string): string {
  return TOOL_NAME_ALIASES[name] ?? name;
}

function readCanvasInputTitle(input: JSONType | undefined): string | undefined {
  return input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    typeof input.title === "string"
    ? input.title
    : undefined;
}

function readToolArguments(rawToolName: string, rawArguments: unknown): ToolArguments {
  if (rawArguments && typeof rawArguments === "object" && !Array.isArray(rawArguments)) {
    return rawArguments as ToolArguments;
  }
  return TOOL_ARGUMENT_ADAPTERS[rawToolName]?.(rawArguments) ?? {};
}

// Single source for tool result text so the fallback order can never drift.
function readToolResultText(data: ToolExecutionCompleteData): string | undefined {
  return data.result?.content ?? data.error?.message;
}

/** Native SQL todos and background agents have Copilot-specific completion rules. */
function resolveCopilotToolPolicy(
  toolName: string,
  args: ToolArguments,
  state: ProjectionState,
): ToolCallProjectionPolicy | undefined {
  if (toolName === "agent" && args?.mode === "background") return { kind: "deferred" };
  if (toolName === "sql" && typeof args?.query === "string") {
    const patches = parseTodoSql(args.query);
    if (patches)
      return {
        kind: "translated",
        projectOnStart: patches.length ? [{ type: "todos_patch", patches }] : [],
      };
  }
  return resolveToolCallPolicy(toolName, args, state);
}
