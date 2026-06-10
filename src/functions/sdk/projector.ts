// Copilot SDK adapter that projects raw SDK events into canonical
// SessionEvents. This module owns SDK-specific projection policy:
// tool name normalization, tool-call visibility/suppression behavior,
// synthetic session events derived from tool calls, todo SQL translation,
// and the shared projection state used by both streaming and history replay.

import { type Attachment, type SessionEvent, type SessionSkill, type ToolCall } from "@/types";
import {
  asRecord,
  readArray,
  readArguments,
  readBoolean,
  readRecord,
  readString,
  readStringPath,
  type SdkSessionEvent,
} from "./extractors";
import { parseTodoSql, type ParsedTodoSql } from "./todoParser";

// ============================================================================
// Types
// ============================================================================

type ToolResult = { content: string; success: boolean };
type VisibleToolDescriptor = {
  toolCallId: string;
  toolName: string;
  arguments: ReturnType<typeof readArguments>;
};
type ToolCallOverride = {
  suppressToolCall?: true;
  projectsOnComplete?: true;
  project?: (
    args: Record<string, unknown> | undefined,
    eventData?: Record<string, unknown> | undefined,
  ) => SessionEvent[];
};
type PendingToolCallProjection = {
  args: Record<string, unknown> | undefined;
  project: NonNullable<ToolCallOverride["project"]>;
};
type SdkProjector = (
  event: SdkSessionEvent,
  context: ProjectionContext,
) => SessionEvent[] | undefined;
type SdkMetadataPatcher = (event: SdkSessionEvent) => SessionMetadataPatch | undefined;
type EventStringFieldByType = Readonly<Record<string, string | undefined>>;

export type SdkStreamTerminalDisposition = "idle" | "error";
export type SessionMetadataPatch = { summary: string; replaceSummary?: boolean };

export type ProjectionState = {
  suppressedToolCallIds: Set<string>;
  backgroundAgentToolCallIds: Set<string>;
  pendingToolCallProjections: Map<string, PendingToolCallProjection>;
  todoSqlCalls: Map<string, ParsedTodoSql>;
};

export type ProjectionContext = {
  streaming: boolean;
  state: ProjectionState;
  attachments?: Attachment[];
  toolResults?: Map<string, ToolResult>;
  childToolCalls?: Map<string, ToolCall[]>;
};

export type HistoryAdaptOptions = {
  resolveAttachments?: (event: SdkSessionEvent, index: number) => Promise<Attachment[] | undefined>;
};

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
  web_fetch: "fetch",
  fetch_webpage: "fetch",
  task: "agent",
};

const SESSION_TITLE_FIELD_BY_EVENT_TYPE = {
  "session.title_changed": "title",
} as const satisfies EventStringFieldByType;

const SESSION_MODEL_FIELD_BY_EVENT_TYPE = {
  "session.start": "selectedModel",
  "session.model_change": "newModel",
  "session.shutdown": "currentModel",
} as const satisfies EventStringFieldByType;

function normalizeToolName(name: string): string {
  return TOOL_NAME_ALIASES[name] ?? name;
}

function readEventString(
  event: Pick<SdkSessionEvent, "type" | "data">,
  fieldByType: EventStringFieldByType,
): string | undefined {
  const field = fieldByType[event.type];
  return field ? readString(event.data, field) : undefined;
}

function readReasoningEffort(data: unknown): string | undefined {
  return readString(data, "reasoningEffort");
}

function projectModelChanged(model: string, data: unknown): SessionEvent {
  const reasoningEffort = readReasoningEffort(data);
  return {
    type: "model_changed",
    modelConfiguration: {
      model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    },
  };
}

function projectLinkedSessionEvent(
  args: Record<string, unknown> | undefined,
  type: "linked_session_added" | "linked_session_removed",
): SessionEvent[] {
  const sessionId = readString(args, "sessionId");
  return sessionId ? [{ type, sessionId }] : [];
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

// Tool calls project normally unless an override is registered here. Overrides
// can suppress the visible tool call, emit synthetic session events, or defer
// those synthetic events until tool completion.
const TOOL_CALL_OVERRIDES: Record<string, ToolCallOverride> = {
  read_agent: {
    suppressToolCall: true,
  },
  create_session: {
    suppressToolCall: true,
    projectsOnComplete: true,
    project: (_args, eventData) => {
      if (!readBoolean(eventData, "success")) {
        return [];
      }

      const sessionId = readCreatedSessionId(eventData);
      return sessionId ? [{ type: "linked_session_added", sessionId }] : [];
    },
  },
  open_session: {
    suppressToolCall: true,
    project: (args) => projectLinkedSessionEvent(args, "linked_session_added"),
  },
  close_session: {
    suppressToolCall: true,
    project: (args) => projectLinkedSessionEvent(args, "linked_session_removed"),
  },
  delete_session: {
    suppressToolCall: true,
    project: (args) => projectLinkedSessionEvent(args, "linked_session_removed"),
  },
  check_session_status: {
    suppressToolCall: true,
  },
  wait_for_sessions: {
    suppressToolCall: true,
  },
  send_to_session: {
    suppressToolCall: true,
  },
  list_automations: {
    suppressToolCall: true,
  },
  create_automation: {
    suppressToolCall: true,
  },
  edit_automation: {
    suppressToolCall: true,
  },
  run_automation: {
    suppressToolCall: true,
  },
};

// ============================================================================
// SDK metadata
// ============================================================================

const SDK_STREAM_TERMINAL: Record<string, SdkStreamTerminalDisposition | undefined> = {
  abort: "error",
  "session.error": "error",
  "session.idle": "idle",
};

const SDK_METADATA_PATCHERS: Record<string, SdkMetadataPatcher | undefined> = {
  "session.handoff": (event) => {
    const summary = readString(event.data, "summary");
    return summary ? { summary, replaceSummary: true } : undefined;
  },
  "session.title_changed": (event) => {
    const title = readEventString(event, SESSION_TITLE_FIELD_BY_EVENT_TYPE);
    return title ? { summary: title, replaceSummary: true } : undefined;
  },
};

// ============================================================================
// Tool call overrides
// ============================================================================

function readSqlQuery(argumentsRecord: Record<string, unknown> | undefined): string | undefined {
  return readString(argumentsRecord, "query");
}

function readTodoSqlCall(
  rawToolName: string,
  toolCallId: string | undefined,
  argumentsRecord: Record<string, unknown> | undefined,
  todoSqlCalls: Map<string, ParsedTodoSql>,
): ParsedTodoSql | undefined {
  if (rawToolName !== "sql") return undefined;
  if (toolCallId && todoSqlCalls.has(toolCallId)) return todoSqlCalls.get(toolCallId);

  const query = readSqlQuery(argumentsRecord);
  if (!query) return undefined;

  const parsed = parseTodoSql(query);
  if (parsed && toolCallId) {
    todoSqlCalls.set(toolCallId, parsed);
  }
  return parsed;
}

function getTodoSqlToolCallOverride(
  rawToolName: string,
  toolCallId: string | undefined,
  argumentsRecord: Record<string, unknown> | undefined,
  state: ProjectionState,
): ToolCallOverride | undefined {
  const parsedTodoSqlCall = readTodoSqlCall(
    rawToolName,
    toolCallId,
    argumentsRecord,
    state.todoSqlCalls,
  );
  if (!parsedTodoSqlCall) return undefined;

  return {
    suppressToolCall: true,
    project: () =>
      parsedTodoSqlCall.patches.length > 0
        ? [{ type: "todos_patch", patches: parsedTodoSqlCall.patches }]
        : [],
  };
}

function getVisibleToolDescriptor(
  rawToolName: string,
  toolCallId: string | undefined,
  argumentsRecord: Record<string, unknown> | undefined,
): VisibleToolDescriptor {
  return {
    toolCallId: toolCallId ?? "",
    toolName: normalizeToolName(rawToolName),
    arguments: readArguments(argumentsRecord),
  };
}

function getToolCallOverride(
  rawToolName: string,
  toolCallId: string | undefined,
  argumentsRecord: Record<string, unknown> | undefined,
  state: ProjectionState,
): ToolCallOverride | undefined {
  const staticOverride = TOOL_CALL_OVERRIDES[rawToolName];
  if (staticOverride) {
    return staticOverride;
  }

  return getTodoSqlToolCallOverride(rawToolName, toolCallId, argumentsRecord, state);
}

function getVisibleToolCall(
  rawToolName: string,
  toolCallId: string | undefined,
  argumentsRecord: Record<string, unknown> | undefined,
  state: ProjectionState,
): VisibleToolDescriptor | undefined {
  if (getToolCallOverride(rawToolName, toolCallId, argumentsRecord, state)) {
    return undefined;
  }

  return getVisibleToolDescriptor(rawToolName, toolCallId, argumentsRecord);
}

// Apply the registered override for a tool.execution_start event. The normal
// visible tool-call path is handled separately when no override exists.
function applyToolCallOverrideOnStart(
  override: ToolCallOverride,
  toolCallId: string | undefined,
  args: Record<string, unknown> | undefined,
  state: ProjectionState,
): SessionEvent[] {
  if (override.suppressToolCall && toolCallId) {
    state.suppressedToolCallIds.add(toolCallId);
  }
  if (override.projectsOnComplete) {
    if (toolCallId && override.project) {
      state.pendingToolCallProjections.set(toolCallId, {
        args,
        project: override.project,
      });
    }
    return [];
  }

  return override.project?.(args) ?? [];
}

// ============================================================================
// Skills helpers
// ============================================================================

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

// History batch projection
// ============================================================================

function collectToolResults(events: SdkSessionEvent[]): Map<string, ToolResult> {
  const toolResults = new Map<string, ToolResult>();

  for (const event of events) {
    if (event.type !== "tool.execution_complete") continue;

    const toolCallId = readString(event.data, "toolCallId");
    if (!toolCallId) continue;

    const content =
      readStringPath(event.data, "result", "content") ??
      readStringPath(event.data, "result", "textResultForLlm") ??
      readStringPath(event.data, "error", "message") ??
      "";

    toolResults.set(toolCallId, {
      content,
      success: readBoolean(event.data, "success"),
    });
  }

  return toolResults;
}

function collectTodoSqlCalls(events: SdkSessionEvent[], state: ProjectionState): void {
  const { todoSqlCalls } = state;

  for (const event of events) {
    if (event.type === "assistant.message") {
      const requests = readArray(event.data, "toolRequests");
      if (!requests?.length) continue;

      for (const request of requests) {
        const req = asRecord(request);
        if (!req) continue;

        readTodoSqlCall(
          readString(req, "name") ?? "",
          readString(req, "toolCallId"),
          readRecord(req, "arguments"),
          todoSqlCalls,
        );
      }
      continue;
    }

    if (event.type !== "tool.execution_start") continue;

    readTodoSqlCall(
      readString(event.data, "toolName") ?? "",
      readString(event.data, "toolCallId"),
      readRecord(event.data, "arguments"),
      todoSqlCalls,
    );
  }
}

function collectChildToolCalls(
  events: SdkSessionEvent[],
  toolResults: Map<string, ToolResult>,
  state: ProjectionState,
): Map<string, ToolCall[]> {
  const children = new Map<string, ToolCall[]>();

  for (const event of events) {
    if (event.type !== "tool.execution_start") continue;
    const parentToolCallId = readString(event.data, "parentToolCallId");
    if (!parentToolCallId) continue;

    const tool = getVisibleToolCall(
      readString(event.data, "toolName") ?? "",
      readString(event.data, "toolCallId"),
      readRecord(event.data, "arguments"),
      state,
    );
    if (!tool) continue;
    const toolCallId = tool.toolCallId;

    const child: ToolCall = {
      toolCallId: tool.toolCallId,
      toolName: tool.toolName,
      arguments: tool.arguments,
      result: toolResults.get(toolCallId),
    };

    const existing = children.get(parentToolCallId);
    if (existing) {
      existing.push(child);
    } else {
      children.set(parentToolCallId, [child]);
    }
  }

  return children;
}

function mapAssistantMessageToolCalls(
  event: SdkSessionEvent,
  toolResults: Map<string, ToolResult>,
  childToolCalls: Map<string, ToolCall[]>,
  state: ProjectionState,
): ToolCall[] | undefined {
  const requests = readArray(event.data, "toolRequests");
  if (!requests?.length) return undefined;

  const calls: ToolCall[] = [];
  for (const request of requests) {
    const req = asRecord(request);
    if (!req) continue;
    const toolCallId = readString(req, "toolCallId");
    if (!toolCallId) continue;
    const tool = getVisibleToolCall(
      readString(req, "name") ?? "",
      toolCallId,
      readRecord(req, "arguments"),
      state,
    );
    if (!tool) continue;

    calls.push({
      toolCallId: tool.toolCallId,
      toolName: tool.toolName,
      arguments: tool.arguments,
      result: toolResults.get(toolCallId),
      childToolCalls: childToolCalls.get(toolCallId),
    });
  }

  return calls.length > 0 ? calls : undefined;
}

// ============================================================================
// Event projection
// ============================================================================

function streamingOnly(fn: SdkProjector): SdkProjector {
  return (event, context) => (context.streaming ? fn(event, context) : undefined);
}

function historyOnly(fn: SdkProjector): SdkProjector {
  return (event, context) => (context.streaming ? undefined : fn(event, context));
}

const SDK_PROJECTORS: Record<string, SdkProjector | undefined> = {
  // ── Streaming-only ──────────────────────────────────────────────────
  "assistant.intent": streamingOnly((event) => [
    { type: "intent", intent: readString(event.data, "intent") ?? "" },
  ]),
  "assistant.message_delta": streamingOnly((event) => [
    { type: "delta", content: readString(event.data, "deltaContent") ?? "" },
  ]),
  "assistant.reasoning_delta": streamingOnly((event) => [
    { type: "reasoning", content: readString(event.data, "deltaContent") ?? "" },
  ]),
  "assistant.turn_start": streamingOnly(() => [{ type: "thinking" }]),
  "session.compaction_complete": streamingOnly(() => [{ type: "compacting_end" }]),
  "session.compaction_start": streamingOnly(() => [{ type: "compacting_start" }]),
  "session.skills_loaded": streamingOnly((event) => {
    const skills = readUserInvocableSkills(event);
    return skills.length > 0 ? [{ type: "skills", skills }] : undefined;
  }),
  "subagent.completed": streamingOnly((event, context) => {
    const toolCallId = readString(event.data, "toolCallId");
    if (!toolCallId) return;
    context.state.backgroundAgentToolCallIds.delete(toolCallId);
    return [{ type: "tool_end", toolCallId, success: true }];
  }),
  "subagent.failed": streamingOnly((event, context) => {
    const toolCallId = readString(event.data, "toolCallId");
    if (!toolCallId) return;
    context.state.backgroundAgentToolCallIds.delete(toolCallId);
    return [{ type: "tool_end", toolCallId, success: false }];
  }),
  "subagent.started": streamingOnly(() => []),
  "tool.execution_complete": (event, context) => {
    const toolCallId = readString(event.data, "toolCallId") ?? "";

    const pendingProjection = context.state.pendingToolCallProjections.get(toolCallId);
    if (pendingProjection) {
      context.state.pendingToolCallProjections.delete(toolCallId);
      context.state.suppressedToolCallIds.delete(toolCallId);
      return pendingProjection.project(pendingProjection.args, asRecord(event.data));
    }

    if (context.state.suppressedToolCallIds.has(toolCallId)) {
      context.state.suppressedToolCallIds.delete(toolCallId);
      return [];
    }

    // Background agents get an early tool_end that just says "Agent started in background...".
    // Skip it — the real completion signal comes from subagent.completed/failed.
    if (context.state.backgroundAgentToolCallIds.has(toolCallId)) {
      return;
    }

    if (!context.streaming) return;

    return [
      {
        type: "tool_end",
        toolCallId,
        parentToolCallId: readString(event.data, "parentToolCallId"),
        success: readBoolean(event.data, "success"),
        result:
          readStringPath(event.data, "result", "content") ??
          readStringPath(event.data, "result", "textResultForLlm") ??
          readStringPath(event.data, "error", "message"),
      },
    ];
  },
  "tool.execution_progress": streamingOnly((event, context) => {
    const toolCallId = readString(event.data, "toolCallId") ?? "";
    if (context.state.suppressedToolCallIds.has(toolCallId)) {
      return [];
    }
    return [
      {
        type: "tool_progress",
        toolCallId,
        message: readString(event.data, "progressMessage") ?? "",
      },
    ];
  }),

  // ── History-only ────────────────────────────────────────────────────
  "session.start": historyOnly((event) => {
    const model = readEventString(event, SESSION_MODEL_FIELD_BY_EVENT_TYPE);
    return model ? [projectModelChanged(model, event.data)] : undefined;
  }),
  "session.shutdown": historyOnly((event) => {
    const model = readEventString(event, SESSION_MODEL_FIELD_BY_EVENT_TYPE);
    return model ? [projectModelChanged(model, event.data)] : undefined;
  }),
  "assistant.message": historyOnly((event, context) => {
    // Sub-agent messages are nested under their parent's tool call tree
    if (readString(event.data, "parentToolCallId")) return;

    const toolCalls =
      context?.toolResults && context?.childToolCalls
        ? mapAssistantMessageToolCalls(
            event,
            context.toolResults,
            context.childToolCalls,
            context.state,
          )
        : undefined;
    return [
      {
        type: "assistant_message",
        content: readString(event.data, "content") ?? "",
        toolCalls: toolCalls?.length ? toolCalls : undefined,
      },
    ];
  }),
  "user.message": historyOnly((event, context) => [
    {
      type: "user_message",
      content: readString(event.data, "content") ?? "",
      timestamp: event.timestamp,
      attachments: context?.attachments,
    },
  ]),

  // ── Both modes ──────────────────────────────────────────────────────
  "session.model_change": (event) => {
    const model = readEventString(event, SESSION_MODEL_FIELD_BY_EVENT_TYPE);
    return model ? [projectModelChanged(model, event.data)] : undefined;
  },
  "session.title_changed": (event) => {
    const title = readEventString(event, SESSION_TITLE_FIELD_BY_EVENT_TYPE);
    return title ? [{ type: "session_title_changed", title }] : undefined;
  },
  "tool.execution_start": (event, context) => {
    const rawToolName = readString(event.data, "toolName") ?? "";
    const args = readRecord(event.data, "arguments");
    const toolCallId = readString(event.data, "toolCallId");
    const override = getToolCallOverride(rawToolName, toolCallId, args, context.state);

    if (override) {
      return applyToolCallOverrideOnStart(override, toolCallId, args, context.state);
    }

    const tool = getVisibleToolDescriptor(rawToolName, toolCallId, args);

    const projected: SessionEvent[] = [];

    // Track background agent task tool calls so we can suppress their early tool_end.
    if (tool.toolName === "agent") {
      if (readString(args, "mode") === "background") {
        if (toolCallId) context.state.backgroundAgentToolCallIds.add(toolCallId);
      }
    }

    // Only emit tool_start during streaming — history assembles tool calls via assistant.message
    if (context.streaming) {
      projected.push({
        type: "tool_start",
        toolName: tool.toolName,
        toolCallId: tool.toolCallId,
        parentToolCallId: readString(event.data, "parentToolCallId"),
        arguments: tool.arguments,
      });
    }
    return projected;
  },
};

// ============================================================================
// Public API
// ============================================================================

export function createProjectionState(): ProjectionState {
  return {
    suppressedToolCallIds: new Set(),
    backgroundAgentToolCallIds: new Set(),
    pendingToolCallProjections: new Map(),
    todoSqlCalls: new Map(),
  };
}

export function getSdkStreamTerminalDisposition(
  type: string,
): SdkStreamTerminalDisposition | undefined {
  return SDK_STREAM_TERMINAL[type];
}

export function getSdkMetadataPatch(event: SdkSessionEvent): SessionMetadataPatch | undefined {
  return SDK_METADATA_PATCHERS[event.type]?.(event);
}

/** Map a single SDK event to canonical SessionEvents. */
export function projectSdkEvent(
  event: SdkSessionEvent,
  context: ProjectionContext,
): SessionEvent[] {
  return SDK_PROJECTORS[event.type]?.(event, context) ?? [];
}

export async function* projectSessionEventsFromSdkHistory(
  events: SdkSessionEvent[],
  options: HistoryAdaptOptions = {},
): AsyncGenerator<SessionEvent, void, undefined> {
  const state = createProjectionState();
  collectTodoSqlCalls(events, state);
  const toolResults = collectToolResults(events);
  const childToolCalls = collectChildToolCalls(events, toolResults, state);

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const attachments =
      event.type === "user.message" && options.resolveAttachments
        ? await options.resolveAttachments(event, i)
        : undefined;

    const context: ProjectionContext = {
      streaming: false,
      state,
      attachments,
      toolResults,
      childToolCalls,
    };
    for (const mapped of projectSdkEvent(event, context)) {
      yield mapped;
    }
  }
}

export type { SdkSessionEvent };
