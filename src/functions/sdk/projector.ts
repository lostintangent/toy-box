// Copilot SDK adapter that projects raw SDK events into canonical
// SessionEvents. This module owns all SDK-specific projection policy for
// live event streams; history replay adapts persisted logs onto this same
// projection in historyReplay.ts.
//
// The file reads top-down: policy tables (tool name aliases, argument-shape
// adapters, stream-terminal dispositions, per-tool projection policies),
// then types and public entry points, then event projection, policy factories,
// and the small field adapters needed at tool-argument boundaries.

import type {
  CanvasOpenedData,
  SessionEvent as SdkSessionEvent,
  ToolExecutionCompleteData,
} from "@github/copilot-sdk";
import { type JsonValue, type SessionEvent, type ToolCall } from "@/types";
import { readAttachmentBlobs } from "./attachments";
import { parseTodoSql } from "./todoParser";

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

// SDK events that terminate a streaming turn, and how.
const SDK_STREAM_TERMINAL: Record<string, SdkStreamTerminalDisposition | undefined> = {
  abort: "error",
  "session.error": "error",
  "session.idle": "idle",
};

// How each tool call projects, keyed by CANONICAL name (post-alias — the
// SDK's "task" resolves the "agent" policy). Tools not listed here are plain
// visible tool calls. Plain entries apply unconditionally; function entries
// decide per call from the tool arguments (factories live in the "Tool call
// policy resolution" section below).
const TOOL_CALL_POLICIES: Record<string, ToolCallPolicyEntry | undefined> = {
  read_agent: { kind: "omitted" },
  check_session_status: { kind: "omitted" },
  wait_for_sessions: { kind: "omitted" },
  send_to_session: { kind: "omitted" },
  list_automations: { kind: "omitted" },
  create_automation: { kind: "omitted" },
  edit_automation: { kind: "omitted" },
  run_automation: { kind: "omitted" },
  create_session: { kind: "translated", projectOnComplete: projectCreatedSession },
  open_session: (args) => ({
    kind: "translated",
    projectOnStart: projectLinkedSessionEvent(args, "linked_session_added"),
  }),
  close_session: (args) => ({
    kind: "translated",
    projectOnStart: projectLinkedSessionEvent(args, "linked_session_removed"),
  }),
  delete_session: (args) => ({
    kind: "translated",
    projectOnStart: projectLinkedSessionEvent(args, "linked_session_removed"),
  }),
  open_canvas: projectOpenCanvasPolicy,
  sql: projectTodoSqlPolicy,
  agent: projectAgentPolicy,
};

// ============================================================================
// Types
// ============================================================================

export type SdkStreamTerminalDisposition = "idle" | "error";
export type SessionMetadataPatch = { summary: string; replaceSummary?: boolean };

export type ProjectionState = {
  toolCallPolicies: Map<string, ToolCallProjectionPolicy>;
};

// How a tool call's lifecycle should project, based on its name + arguments.
// `undefined` means a plain visible tool call. Policies are stored
// in ProjectionState keyed by toolCallId, because later lifecycle events
// (progress/complete) don't carry the tool name.
type ToolCallProjectionPolicy =
  | { kind: "omitted" }
  | {
      kind: "translated";
      // Synthetic events to emit when the call starts / completes.
      projectOnStart?: SessionEvent[];
      projectOnComplete?: (eventData: ToolExecutionCompleteData) => SessionEvent[];
    }
  | {
      kind: "augmented";
      // The tool remains visible, while completion also emits semantic events.
      projectOnComplete?: (eventData: ToolExecutionCompleteData) => SessionEvent[];
    }
  | {
      kind: "deferred";
      completionEvents: {
        success: "subagent.completed";
        failure: "subagent.failed";
      };
    };

type ToolArguments = ToolCall["arguments"];
type ToolCallPolicyFactory = (args: ToolArguments) => ToolCallProjectionPolicy | undefined;
type ToolCallPolicyEntry = ToolCallProjectionPolicy | ToolCallPolicyFactory;

// ============================================================================
// Public API
// ============================================================================

export function createProjectionState(): ProjectionState {
  return { toolCallPolicies: new Map() };
}

/** Map a single SDK event to canonical SessionEvents. */
export function projectSdkEvent(event: SdkSessionEvent, state: ProjectionState): SessionEvent[] {
  switch (event.type) {
    // Empty-content deltas are dropped at the source: they carry nothing, and
    // downstream consumers (reducer message fragmentation, stream buffering)
    // should never have to guard against them.
    case "user.message":
      // Subagent prompts are not root user turns — they're already visible as
      // the agent tool call's arguments.
      return event.agentId
        ? []
        : [
            {
              type: "user_message",
              content: event.data.content,
              timestamp: event.timestamp,
              attachments: readAttachmentBlobs(event.data.attachments),
            },
          ];
    case "assistant.message":
      return [
        {
          type: "assistant_message",
          ...(event.agentId ? { agentId: event.agentId } : {}),
          content: event.data.content,
        },
      ];
    case "assistant.message_delta": {
      // TODO: Route sub-agent deltas into their parent agent tool call once the
      // agent tool UI can render live child assistant output.
      if (event.agentId) return [];
      const content = event.data.deltaContent;
      return content ? [{ type: "delta", content }] : [];
    }
    case "assistant.reasoning_delta": {
      const content = event.data.deltaContent;
      const agentId = event.agentId;
      return content ? [{ type: "reasoning", content, ...(agentId ? { agentId } : {}) }] : [];
    }
    case "assistant.turn_start":
      return event.agentId ? [] : [{ type: "status", status: "thinking" }];
    case "session.compaction_complete":
      return event.agentId ? [] : [{ type: "status", status: "thinking" }];
    case "session.compaction_start":
      return event.agentId ? [] : [{ type: "status", status: "compacting" }];
    case "session.start":
      return projectSessionStart(event.data.selectedModel, event.data.reasoningEffort);
    case "session.model_change":
      return [
        {
          type: "model_changed",
          modelConfiguration: {
            model: event.data.newModel,
            ...(event.data.reasoningEffort ? { reasoningEffort: event.data.reasoningEffort } : {}),
          },
        },
      ];
    case "session.skills_loaded": {
      const skills = event.data.skills
        .filter((skill) => skill.userInvocable && skill.enabled)
        .map((skill) => ({ name: skill.name, description: skill.description }));
      return skills.length > 0 ? [{ type: "skills", skills }] : [];
    }
    case "session.title_changed":
      return [{ type: "session_title_changed", title: event.data.title }];
    case "subagent.started": {
      const agentId = event.data.toolCallId ?? event.agentId;
      const model = event.data.model;
      return agentId && model
        ? [{ type: "model_changed", agentId, modelConfiguration: { model } }]
        : [];
    }
    case "subagent.completed":
    case "subagent.failed": {
      const { toolCallId } = event.data;
      const policy = state.toolCallPolicies.get(toolCallId);
      if (policy?.kind !== "deferred") return [];

      const { completionEvents } = policy;
      const success = event.type === completionEvents.success;
      state.toolCallPolicies.delete(toolCallId);
      return [{ type: "tool_end", toolCallId, success }];
    }
    case "tool.execution_start": {
      const rawToolName = event.data.toolName;
      const toolName = normalizeToolName(rawToolName);
      const args = readToolArguments(rawToolName, event.data.arguments);
      const toolCallId = event.data.toolCallId;
      const agentId = event.agentId;
      const policy = resolveToolCallPolicy(toolName, args);

      if (policy) state.toolCallPolicies.set(toolCallId, policy);
      if (policy?.kind === "omitted") return [];
      if (policy?.kind === "translated") return policy.projectOnStart ?? [];

      return [
        {
          type: "tool_start",
          toolName,
          toolCallId,
          ...(agentId ? { agentId } : {}),
          arguments: args,
        },
      ];
    }
    case "tool.execution_complete": {
      const { data } = event;
      const { toolCallId } = data;
      const agentId = event.agentId;
      const policy = state.toolCallPolicies.get(toolCallId);

      if (policy?.kind === "omitted") {
        state.toolCallPolicies.delete(toolCallId);
        return [];
      }

      if (policy?.kind === "translated") {
        state.toolCallPolicies.delete(toolCallId);
        return policy.projectOnComplete?.(data) ?? [];
      }

      const toolEnd: SessionEvent = {
        type: "tool_end",
        toolCallId,
        ...(agentId ? { agentId } : {}),
        success: data.success,
        result: readToolResultText(data),
        details: data.result?.detailedContent,
      };

      if (policy?.kind === "augmented") {
        state.toolCallPolicies.delete(toolCallId);
        return [toolEnd, ...(policy.projectOnComplete?.(data) ?? [])];
      }

      // Background tool calls can have a non-authoritative SDK completion event.
      // Skip it when another declared SDK event is the real completion source.
      if (policy?.kind === "deferred") return [];

      return [toolEnd];
    }
    default:
      return [];
  }
}

export function getSdkStreamTerminalDisposition(
  type: string,
): SdkStreamTerminalDisposition | undefined {
  return SDK_STREAM_TERMINAL[type];
}

export function getSdkMetadataPatch(event: SdkSessionEvent): SessionMetadataPatch | undefined {
  switch (event.type) {
    case "session.handoff":
      return event.data.summary ? { summary: event.data.summary, replaceSummary: true } : undefined;
    case "session.title_changed":
      return { summary: event.data.title, replaceSummary: true };
    default:
      return undefined;
  }
}

// ============================================================================
// Tool call policy resolution
// ============================================================================

// Decide how a tool call projects, purely from its CANONICAL name (post-
// TOOL_NAME_ALIASES, so e.g. the SDK's "task" resolves the "agent" policy)
// and arguments. Static policies live in TOOL_CALL_POLICIES; dynamic policies
// use arguments to build translated events or to detect tool calls completed
// by another lifecycle.
function resolveToolCallPolicy(
  toolName: string,
  args: ToolArguments,
): ToolCallProjectionPolicy | undefined {
  const entry = TOOL_CALL_POLICIES[toolName];
  if (!entry) return undefined;
  return typeof entry === "function" ? entry(args) : entry;
}

function projectSessionStart(
  model: string | undefined,
  reasoningEffort: string | undefined,
): SessionEvent[] {
  return model
    ? [
        {
          type: "model_changed",
          modelConfiguration: {
            model,
            ...(reasoningEffort ? { reasoningEffort } : {}),
          },
        },
      ]
    : [];
}

function projectTodoSqlPolicy(args: ToolArguments): ToolCallProjectionPolicy | undefined {
  // Todo-list SQL calls are translated into todos_patch events; other SQL stays visible.
  const query = readStringArg(args, "query");
  const parsed = query ? parseTodoSql(query) : undefined;
  if (!parsed) return undefined;
  return {
    kind: "translated",
    projectOnStart:
      parsed.patches.length > 0 ? [{ type: "todos_patch", patches: parsed.patches }] : [],
  };
}

function projectOpenCanvasPolicy(args: ToolArguments): ToolCallProjectionPolicy {
  return {
    kind: "augmented",
    projectOnComplete: (eventData) => projectCanvasOpened(args, eventData),
  };
}

function projectAgentPolicy(args: ToolArguments): ToolCallProjectionPolicy | undefined {
  // Background agent calls stay visible, but their SDK tool completion is
  // not the real completion signal. subagent.completed/failed owns that.
  if (readStringArg(args, "mode") !== "background") return undefined;
  return {
    kind: "deferred",
    completionEvents: {
      success: "subagent.completed",
      failure: "subagent.failed",
    },
  };
}

function projectLinkedSessionEvent(
  args: Record<string, unknown> | undefined,
  type: "linked_session_added" | "linked_session_removed",
): SessionEvent[] {
  const sessionId = readStringArg(args, "sessionId");
  return sessionId ? [{ type, sessionId }] : [];
}

function projectCanvasOpened(
  startArgs: ToolArguments,
  eventData: ToolExecutionCompleteData,
): SessionEvent[] {
  if (!eventData.success) return [];

  const result = readJsonToolResult<CanvasOpenedData>(eventData);
  if (!result?.url) return [];

  const input = readCanvasInput(result, startArgs);
  const title = result.title ?? readCanvasInputTitle(input) ?? result.canvasId;

  return [
    {
      type: "canvas_opened",
      canvas: {
        canvasId: result.canvasId,
        instanceId: result.instanceId,
        url: result.url,
        title,
        extensionId: result.extensionId,
        ...(result.extensionName ? { extensionName: result.extensionName } : {}),
        ...(result.status ? { status: result.status } : {}),
        availability: result.availability,
        ...(input !== undefined ? { input } : {}),
        ...(result.reopen ? { reopen: true } : {}),
      },
    },
  ];
}

function readJsonToolResult<T>(eventData: ToolExecutionCompleteData): T | undefined {
  const raw = eventData.result?.detailedContent ?? eventData.result?.content;
  if (!raw) return undefined;

  return JSON.parse(raw) as T;
}

type CreatedSessionResult = { sessionId: string };

function projectCreatedSession(eventData: ToolExecutionCompleteData): SessionEvent[] {
  if (!eventData.success) return [];
  const sessionId = readCreatedSessionId(eventData);
  return sessionId ? [{ type: "linked_session_added", sessionId }] : [];
}

function readCreatedSessionId(eventData: ToolExecutionCompleteData): string | undefined {
  return readJsonToolResult<CreatedSessionResult>(eventData)?.sessionId;
}

// ============================================================================
// Field readers
// ============================================================================

function normalizeToolName(name: string): string {
  return TOOL_NAME_ALIASES[name] ?? name;
}

function toToolArguments(value: Record<string, unknown> | undefined): ToolArguments {
  return (value ?? {}) as ToolArguments;
}

function readStringArg(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const result = value?.[key];
  return typeof result === "string" ? result : undefined;
}

function readCanvasInput(
  result: CanvasOpenedData,
  startArgs: ToolArguments,
): JsonValue | undefined {
  return (result.input ?? startArgs.input) as JsonValue | undefined;
}

function readCanvasInputTitle(input: JsonValue | undefined): string | undefined {
  return input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    typeof input.title === "string"
    ? input.title
    : undefined;
}

function readToolArguments(rawToolName: string, rawArguments: unknown): ToolArguments {
  if (rawArguments && typeof rawArguments === "object" && !Array.isArray(rawArguments)) {
    return toToolArguments(rawArguments as Record<string, unknown>);
  }
  return TOOL_ARGUMENT_ADAPTERS[rawToolName]?.(rawArguments) ?? {};
}

// Single source for tool result text so the fallback order can never drift.
function readToolResultText(data: ToolExecutionCompleteData): string | undefined {
  return data.result?.content ?? data.error?.message;
}
