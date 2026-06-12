// Copilot SDK adapter that projects raw SDK events into canonical
// SessionEvents. This module owns all SDK-specific projection policy for
// live event streams; history replay adapts persisted logs onto this same
// projection in historyReplay.ts.
//
// The file reads top-down: policy tables (tool name aliases, argument-shape
// adapters, stream-terminal dispositions, per-tool projection policies),
// then types and public entry points, then the per-event projection tables
// that do the work, and finally the policy factories and field readers they
// dispatch to.

import { type SessionEvent, type SessionSkill } from "@/types";
import {
  asRecord,
  readArray,
  readArguments,
  readBoolean,
  readPath,
  readString,
  readStringPath,
  type SdkSessionEvent,
} from "./extractors";
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
const TOOL_CALL_POLICIES = {
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
  sql: projectTodoSqlPolicy,
  agent: projectAgentPolicy,
} satisfies Record<string, ToolCallPolicyEntry>;

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
      projectOnComplete?: (eventData: Record<string, unknown> | undefined) => SessionEvent[];
    }
  | {
      kind: "deferred";
      completionEvents: {
        success: SdkSessionEvent["type"];
        failure: SdkSessionEvent["type"];
      };
    };

type ToolArguments = ReturnType<typeof readArguments>;
type ToolCallPolicyFactory = (args: ToolArguments) => ToolCallProjectionPolicy | undefined;
type ToolCallPolicyEntry = ToolCallProjectionPolicy | ToolCallPolicyFactory;
type SdkProjector = (event: SdkSessionEvent, state: ProjectionState) => SessionEvent[];
type SdkMetadataPatcher = (event: SdkSessionEvent) => SessionMetadataPatch | undefined;

// ============================================================================
// Public API
// ============================================================================

export function createProjectionState(): ProjectionState {
  return { toolCallPolicies: new Map() };
}

/** Map a single SDK event to canonical SessionEvents. */
export function projectSdkEvent(event: SdkSessionEvent, state: ProjectionState): SessionEvent[] {
  return SDK_PROJECTORS[event.type]?.(event, state) ?? [];
}

export function getSdkStreamTerminalDisposition(
  type: string,
): SdkStreamTerminalDisposition | undefined {
  return SDK_STREAM_TERMINAL[type];
}

export function getSdkMetadataPatch(event: SdkSessionEvent): SessionMetadataPatch | undefined {
  return SDK_METADATA_PATCHERS[event.type]?.(event);
}

// ============================================================================
// Event projection tables
// ============================================================================

const SDK_PROJECTORS: Record<string, SdkProjector | undefined> = {
  // Empty-content deltas are dropped at the source: they carry nothing, and
  // downstream consumers (reducer message fragmentation, stream buffering)
  // should never have to guard against them.
  "assistant.message_delta": (event) => {
    // TODO: Route sub-agent deltas into their parent agent tool call once the
    // agent tool UI can render live child assistant output.
    if (readString(event, "agentId")) return [];
    const content = readString(event.data, "deltaContent") ?? "";
    return content ? [{ type: "delta", content }] : [];
  },
  "assistant.reasoning_delta": (event) => {
    const content = readString(event.data, "deltaContent") ?? "";
    const agentId = readString(event, "agentId");
    return content ? [{ type: "reasoning", content, ...(agentId ? { agentId } : {}) }] : [];
  },
  "assistant.turn_start": (event) =>
    readString(event, "agentId") ? [] : [{ type: "thinking" }],
  "session.compaction_complete": (event) =>
    readString(event, "agentId") ? [] : [{ type: "compacting_end" }],
  "session.compaction_start": (event) =>
    readString(event, "agentId") ? [] : [{ type: "compacting_start" }],
  "session.model_change": (event) => projectModelChanged(event, "newModel"),
  "session.skills_loaded": (event) => {
    const skills = readUserInvocableSkills(event);
    return skills.length > 0 ? [{ type: "skills", skills }] : [];
  },
  "session.title_changed": (event) => {
    const title = readString(event.data, "title");
    return title ? [{ type: "session_title_changed", title }] : [];
  },
  "subagent.started": (event) => {
    const agentId = readString(event.data, "toolCallId") ?? readString(event, "agentId");
    const model = readString(event.data, "model");
    return agentId && model
      ? [{ type: "model_changed", agentId, modelConfiguration: { model } }]
      : [];
  },
  "subagent.completed": projectBackgroundToolCompletion(),
  "subagent.failed": projectBackgroundToolCompletion(),
  "tool.execution_start": (event, state) => {
    const rawToolName = readString(event.data, "toolName") ?? "";
    const toolName = normalizeToolName(rawToolName);
    const args = readToolArguments(rawToolName, readPath(event.data, "arguments"));
    const toolCallId = readString(event.data, "toolCallId");
    const agentId = readString(event, "agentId");
    const policy = resolveToolCallPolicy(toolName, args);

    if (policy && toolCallId) {
      state.toolCallPolicies.set(toolCallId, policy);
    }
    if (policy?.kind === "omitted") {
      return [];
    }
    if (policy?.kind === "translated") {
      return policy.projectOnStart ?? [];
    }

    return [
      {
        type: "tool_start",
        toolName,
        toolCallId: toolCallId ?? "",
        ...(agentId ? { agentId } : {}),
        arguments: args,
      },
    ];
  },
  "tool.execution_complete": (event, state) => {
    const toolCallId = readString(event.data, "toolCallId") ?? "";
    const agentId = readString(event, "agentId");
    const policy = state.toolCallPolicies.get(toolCallId);

    if (policy?.kind === "omitted") {
      state.toolCallPolicies.delete(toolCallId);
      return [];
    }

    if (policy?.kind === "translated") {
      state.toolCallPolicies.delete(toolCallId);
      return policy.projectOnComplete?.(asRecord(event.data)) ?? [];
    }

    // Background tool calls can have a non-authoritative SDK completion event.
    // Skip it when another declared SDK event is the real completion source.
    if (policy?.kind === "deferred") return [];

    return [
      {
        type: "tool_end",
        toolCallId,
        ...(agentId ? { agentId } : {}),
        success: readBoolean(event.data, "success"),
        result: readToolResultText(event.data),
        details: readStringPath(event.data, "result", "detailedContent"),
      },
    ];
  },
};

const SDK_METADATA_PATCHERS: Record<string, SdkMetadataPatcher | undefined> = {
  "session.handoff": (event) => {
    const summary = readString(event.data, "summary");
    return summary ? { summary, replaceSummary: true } : undefined;
  },
  "session.title_changed": (event) => {
    const title = readString(event.data, "title");
    return title ? { summary: title, replaceSummary: true } : undefined;
  },
};

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
  const entry = TOOL_CALL_POLICIES[toolName as keyof typeof TOOL_CALL_POLICIES];
  if (!entry) return undefined;
  return typeof entry === "function" ? entry(args) : entry;
}

function projectTodoSqlPolicy(args: ToolArguments): ToolCallProjectionPolicy | undefined {
  // Todo-list SQL calls are translated into todos_patch events; other SQL stays visible.
  const query = readString(args, "query");
  const parsed = query ? parseTodoSql(query) : undefined;
  if (!parsed) return undefined;
  return {
    kind: "translated",
    projectOnStart:
      parsed.patches.length > 0 ? [{ type: "todos_patch", patches: parsed.patches }] : [],
  };
}

function projectAgentPolicy(args: ToolArguments): ToolCallProjectionPolicy | undefined {
  // Background agent calls stay visible, but their SDK tool completion is
  // not the real completion signal. subagent.completed/failed owns that.
  if (readString(args, "mode") !== "background") return undefined;
  return {
    kind: "deferred",
    completionEvents: {
      success: "subagent.completed",
      failure: "subagent.failed",
    },
  };
}

// The projector-side half of the deferred policy above: when the declared
// completion event arrives, emit the real tool_end.
function projectBackgroundToolCompletion(): SdkProjector {
  return (event, state) => {
    const toolCallId = readString(event.data, "toolCallId");
    if (!toolCallId) return [];

    const policy = state.toolCallPolicies.get(toolCallId);
    if (policy?.kind !== "deferred") return [];

    const { completionEvents } = policy;
    const success =
      event.type === completionEvents.success
        ? true
        : event.type === completionEvents.failure
          ? false
          : undefined;
    if (success === undefined) return [];

    state.toolCallPolicies.delete(toolCallId);
    return [{ type: "tool_end", toolCallId, success }];
  };
}

function projectLinkedSessionEvent(
  args: Record<string, unknown> | undefined,
  type: "linked_session_added" | "linked_session_removed",
): SessionEvent[] {
  const sessionId = readString(args, "sessionId");
  return sessionId ? [{ type, sessionId }] : [];
}

function projectCreatedSession(eventData: Record<string, unknown> | undefined): SessionEvent[] {
  if (!readBoolean(eventData, "success")) return [];
  const sessionId = readCreatedSessionId(eventData);
  return sessionId ? [{ type: "linked_session_added", sessionId }] : [];
}

function readCreatedSessionId(eventData: Record<string, unknown> | undefined): string | undefined {
  const resultText =
    readStringPath(eventData, "result", "content") ??
    readStringPath(eventData, "result", "textResultForLlm");
  if (!resultText) return undefined;

  try {
    return readStringPath(asRecord(JSON.parse(resultText)), "sessionId");
  } catch {
    return undefined;
  }
}

// ============================================================================
// Field readers
// ============================================================================

function normalizeToolName(name: string): string {
  return TOOL_NAME_ALIASES[name] ?? name;
}

function readToolArguments(rawToolName: string, rawArguments: unknown): ToolArguments {
  const argumentsRecord = asRecord(rawArguments);
  if (argumentsRecord) return readArguments(argumentsRecord);
  return TOOL_ARGUMENT_ADAPTERS[rawToolName]?.(rawArguments) ?? {};
}

// Single source for tool result text so the fallback order can never drift.
function readToolResultText(data: unknown): string | undefined {
  return (
    readStringPath(data, "result", "content") ??
    readStringPath(data, "result", "textResultForLlm") ??
    readStringPath(data, "error", "message")
  );
}

/** Project a model-bearing SDK event field into a model_changed event.
 *  Shared with historyReplay.ts, which reads the model from session
 *  lifecycle records (session.start/shutdown). */
export function projectModelChanged(event: SdkSessionEvent, field: string): SessionEvent[] {
  const model = readString(event.data, field);
  if (!model) return [];

  const reasoningEffort = readString(event.data, "reasoningEffort");
  return [
    {
      type: "model_changed",
      modelConfiguration: {
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      },
    },
  ];
}

function readUserInvocableSkills(event: SdkSessionEvent): SessionSkill[] {
  const raw = readArray(event.data, "skills");
  if (!raw?.length) return [];

  const skills: SessionSkill[] = [];
  for (const entry of raw) {
    const r = asRecord(entry);
    if (!r || !readBoolean(r, "userInvocable") || !readBoolean(r, "enabled")) continue;
    const name = readString(r, "name");
    if (name) skills.push({ name, description: readString(r, "description") ?? "" });
  }
  return skills;
}

export type { SdkSessionEvent };
