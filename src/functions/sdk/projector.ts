// Copilot SDK adapter that projects raw SDK events into canonical
// SessionEvents. This module owns SDK-specific policy such as hidden
// tools, tool normalization, todo SQL translation, and per-projection
// state for both streaming and history replay.

import type { Attachment, SessionEvent, SessionSkill, ToolCall } from "@/types";
import {
  asRecord,
  readArray,
  readArguments,
  readBoolean,
  readSessionModel,
  readRecord,
  readSessionTitleFromTitleChanged,
  readString,
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
type ClassifiedToolCall =
  | { kind: "hidden" }
  | { kind: "todo_sql"; parsed: ParsedTodoSql }
  | { kind: "visible"; tool: VisibleToolDescriptor };
type SdkProjector = (
  event: SdkSessionEvent,
  context: ProjectionContext,
) => SessionEvent[] | undefined;
type SdkMetadataPatcher = (event: SdkSessionEvent) => SessionMetadataPatch | undefined;

export type SdkStreamTerminalDisposition = "idle" | "error";
export type SessionMetadataPatch = { summary: string; replaceSummary?: boolean };

export type ProjectionState = {
  hiddenToolCallIds: Set<string>;
  backgroundAgentToolCallIds: Set<string>;
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

// Tools whose events should never be projected into the UI.
const HIDDEN_TOOLS = new Set(["read_agent"]);

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

function normalizeToolName(name: string): string {
  return TOOL_NAME_ALIASES[name] ?? name;
}

export function createProjectionState(): ProjectionState {
  return {
    hiddenToolCallIds: new Set(),
    backgroundAgentToolCallIds: new Set(),
    todoSqlCalls: new Map(),
  };
}

function isHiddenToolEvent(event: SdkSessionEvent, state: ProjectionState): boolean {
  if (!event.type.startsWith("tool.")) return false;

  const toolCallId = readString(event.data, "toolCallId");

  // tool.execution_start carries toolName — seed the hidden ID set
  if (event.type === "tool.execution_start") {
    const toolName = readString(event.data, "toolName");
    if (toolName !== undefined && HIDDEN_TOOLS.has(toolName)) {
      if (toolCallId) state.hiddenToolCallIds.add(toolCallId);
      return true;
    }
    return false;
  }

  // Subsequent events (complete/progress) only carry toolCallId
  if (toolCallId && state.hiddenToolCallIds.has(toolCallId)) {
    if (event.type === "tool.execution_complete") state.hiddenToolCallIds.delete(toolCallId);
    return true;
  }
  return false;
}

// ============================================================================
// Event classification
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
    const title = readSessionTitleFromTitleChanged(event);
    return title ? { summary: title, replaceSummary: true } : undefined;
  },
};

// ============================================================================
// Mode helpers
// ============================================================================

function streamingOnly(fn: SdkProjector): SdkProjector {
  return (event, context) => (context.streaming ? fn(event, context) : undefined);
}

function historyOnly(fn: SdkProjector): SdkProjector {
  return (event, context) => (context.streaming ? undefined : fn(event, context));
}

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

function classifyToolCall(
  rawToolName: string,
  toolCallId: string | undefined,
  argumentsRecord: Record<string, unknown> | undefined,
  state: ProjectionState,
): ClassifiedToolCall {
  if (HIDDEN_TOOLS.has(rawToolName)) {
    return { kind: "hidden" };
  }

  const parsedTodoSqlCall = readTodoSqlCall(
    rawToolName,
    toolCallId,
    argumentsRecord,
    state.todoSqlCalls,
  );
  if (parsedTodoSqlCall) {
    return { kind: "todo_sql", parsed: parsedTodoSqlCall };
  }

  return {
    kind: "visible",
    tool: {
      toolCallId: toolCallId ?? "",
      toolName: normalizeToolName(rawToolName),
      arguments: readArguments(argumentsRecord),
    },
  };
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

// ============================================================================
// Event projection
// ============================================================================

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
    const classified = classifyToolCall(
      readString(req, "name") ?? "",
      toolCallId,
      readRecord(req, "arguments"),
      state,
    );
    if (classified.kind !== "visible") continue;

    calls.push({
      toolCallId: classified.tool.toolCallId,
      toolName: classified.tool.toolName,
      arguments: classified.tool.arguments,
      result: toolResults.get(toolCallId),
      childToolCalls: childToolCalls.get(toolCallId),
    });
  }

  return calls.length > 0 ? calls : undefined;
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

    if (context.state.hiddenToolCallIds.has(toolCallId)) {
      context.state.hiddenToolCallIds.delete(toolCallId);
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
          readString(readRecord(event.data, "result"), "content") ??
          readString(readRecord(event.data, "error"), "message"),
      },
    ];
  },
  "tool.execution_progress": streamingOnly((event, context) => {
    const toolCallId = readString(event.data, "toolCallId") ?? "";
    if (context.state.hiddenToolCallIds.has(toolCallId)) {
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
    const model = readSessionModel(event);
    return model ? [{ type: "model_changed", model }] : undefined;
  }),
  "session.shutdown": historyOnly((event) => {
    const model = readSessionModel(event);
    return model ? [{ type: "model_changed", model }] : undefined;
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
    const model = readSessionModel(event);
    return model ? [{ type: "model_changed", model }] : undefined;
  },
  "session.title_changed": (event) => {
    const title = readSessionTitleFromTitleChanged(event);
    return title ? [{ type: "session_title_changed", title }] : undefined;
  },
  "tool.execution_start": (event, context) => {
    const args = readRecord(event.data, "arguments");
    const toolCallId = readString(event.data, "toolCallId");
    const classified = classifyToolCall(
      readString(event.data, "toolName") ?? "",
      toolCallId,
      args,
      context.state,
    );

    if (classified.kind === "todo_sql" && toolCallId) {
      context.state.hiddenToolCallIds.add(toolCallId);
      return classified.parsed.patches.length > 0
        ? [{ type: "todos_patch", patches: classified.parsed.patches }]
        : [];
    }

    if (classified.kind !== "visible") {
      return [];
    }

    const projected: SessionEvent[] = [];

    // Track background agent task tool calls so we can suppress their early tool_end.
    if (classified.tool.toolName === "agent") {
      if (readString(args, "mode") === "background") {
        if (toolCallId) context.state.backgroundAgentToolCallIds.add(toolCallId);
      }
    }

    // Only emit tool_start during streaming — history assembles tool calls via assistant.message
    if (context.streaming) {
      projected.push({
        type: "tool_start",
        toolName: classified.tool.toolName,
        toolCallId: classified.tool.toolCallId,
        parentToolCallId: readString(event.data, "parentToolCallId"),
        arguments: classified.tool.arguments,
      });
    }
    return projected;
  },
};

// ============================================================================
// Public API
// ============================================================================

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
  if (isHiddenToolEvent(event, context.state)) return [];
  return SDK_PROJECTORS[event.type]?.(event, context) ?? [];
}

// ============================================================================
// History batch projection
// ============================================================================

function collectToolResults(events: SdkSessionEvent[]): Map<string, ToolResult> {
  const toolResults = new Map<string, ToolResult>();

  for (const event of events) {
    if (event.type !== "tool.execution_complete") continue;

    const toolCallId = readString(event.data, "toolCallId");
    if (!toolCallId) continue;

    const content =
      readString(readRecord(event.data, "result"), "content") ??
      readString(readRecord(event.data, "error"), "message") ??
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

    const toolCallId = readString(event.data, "toolCallId") ?? "";
    const classified = classifyToolCall(
      readString(event.data, "toolName") ?? "",
      toolCallId,
      readRecord(event.data, "arguments"),
      state,
    );
    if (classified.kind !== "visible") continue;

    const child: ToolCall = {
      toolCallId: classified.tool.toolCallId,
      toolName: classified.tool.toolName,
      arguments: classified.tool.arguments,
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
