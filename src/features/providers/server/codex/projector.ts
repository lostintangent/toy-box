// Live notifications and history-derived inputs share one event projector.
// Native item IDs own deduplication; deltas preview authoritative completions.
import type { SessionEvent, ToolCall } from "@sessions/model";
import {
  resolveToolCallPolicy,
  type ToolCallProjectionPolicy,
  type ToolCompletion,
} from "@sessions/server/toolProjection";
import type { Thread, ThreadItem, Turn } from "./protocol";
import type { RpcNotification } from "./protocol/transport";
import { decodeInput } from "./messages";
import { fileChangesDiff } from "./fileChanges";

/** The subagent thread whose first turn completes this activity's agent card. */
export function subagentThreadId(item: ThreadItem): string | undefined {
  return item.type === "subAgentActivity" && item.kind === "started"
    ? item.agentThreadId
    : undefined;
}

export function codexModel(name: string, reasoningEffort: string | null) {
  return { provider: "codex", name, ...(reasoningEffort ? { reasoningEffort } : {}) };
}

/** Project one root thread, nesting its subagent threads inside their agent cards. */
export function createCodexProjector(sessionId: string, threadId: string) {
  const turnsWithInput = new Set<string>();
  const items = new Map<string, "completed" | { policy?: ToolCallProjectionPolicy }>();
  const subagents = new Map<
    string,
    { toolCallId: string; project: (event: RpcNotification) => SessionEvent[] }
  >();
  let turn: Pick<Turn, "id" | "startedAt"> | undefined;
  let itemIndex = 0;

  return (event: RpcNotification): SessionEvent[] => {
    const { method, params } = event;
    const eventThread = "threadId" in params ? params.threadId : params.thread.id;
    if (eventThread !== threadId) return projectSubagent(eventThread, event);
    const events: SessionEvent[] = [];
    switch (method) {
      case "thread/started": {
        const { model, reasoningEffort } = params.thread;
        if (model)
          events.push({ type: "model_changed", model: codexModel(model, reasoningEffort) });
        break;
      }
      case "turn/started":
        turn = params.turn;
        itemIndex = 0;
        return [{ type: "status", status: "thinking" }];
      case "turn/completed": {
        const { turn } = params;
        for (const [index, item] of turn.items.entries())
          events.push(...projectItem(item, turn.id, true, itemTimestamp(turn, index)));
        events.push({
          type: "end",
          reason: turn.status === "failed" ? "error" : "idle",
          ...(turn.status === "failed" && turn.error?.message ? { error: turn.error.message } : {}),
        });
        break;
      }
      case "item/started":
      case "item/completed": {
        const { item, turnId } = params;
        return projectItem(item, turnId, method === "item/completed");
      }
      case "item/agentMessage/delta": {
        const { delta, itemId } = params;
        return delta ? [{ type: "delta", content: delta, messageId: itemId }] : [];
      }
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        const { delta } = params;
        return delta ? [{ type: "reasoning_delta", content: delta }] : [];
      }
      case "item/reasoning/summaryPartAdded":
        return [{ type: "reasoning_delta", content: "\n\n" }];
      case "item/commandExecution/outputDelta": {
        const { delta, itemId } = params;
        return delta ? [{ type: "tool_output_delta", toolCallId: itemId, content: delta }] : [];
      }
      case "thread/tokenUsage/updated": {
        // Codex counts the last request's total tokens as the context in use.
        const { last, modelContextWindow } = params.tokenUsage;
        return modelContextWindow
          ? [
              {
                type: "context_usage_changed",
                usage: { tokens: last.totalTokens, tokenWindow: modelContextWindow },
              },
            ]
          : [];
      }
      case "turn/plan/updated":
        events.push({
          type: "todos_patch",
          patches: [
            {
              type: "replace_all",
              items: params.plan.map((step, index) => ({
                id: `codex-plan-${index}`,
                title: step.step,
                status:
                  step.status === "completed"
                    ? "done"
                    : step.status === "inProgress"
                      ? "in_progress"
                      : "pending",
              })),
            },
          ],
        });
        break;
      case "thread/name/updated": {
        const name = params.threadName;
        return name ? [{ type: "session_title_changed", title: name }] : [];
      }
    }
    return events;
  };

  function projectSubagent(subagentThreadId: string, event: RpcNotification): SessionEvent[] {
    const subagent = subagents.get(subagentThreadId);
    if (!subagent) return [];
    const { toolCallId, project } = subagent;
    // The card completes with the first turn, or when the thread closes without one.
    const projected: SessionEvent[] =
      event.method === "thread/closed" ? [{ type: "end", reason: "idle" }] : project(event);
    return projected.flatMap((child): SessionEvent[] => {
      switch (child.type) {
        case "end":
          subagents.delete(subagentThreadId);
          return [
            {
              type: "tool_end",
              toolCallId,
              success: child.reason !== "error",
              ...(child.error ? { result: child.error } : {}),
            },
          ];
        case "assistant_message":
        case "reasoning":
        case "reasoning_delta":
        case "tool_start":
        case "tool_output_delta":
        case "tool_end":
        case "model_changed":
          return [{ ...child, parentToolCallId: toolCallId }];
        default:
          return [];
      }
    });
  }

  function projectItem(
    item: ThreadItem,
    turnId: string,
    complete: boolean,
    timestamp?: string,
  ): SessionEvent[] {
    const previous = items.get(item.id);
    if (previous === "completed" || (previous && !complete)) return [];
    const index = itemIndex;
    if (!previous) itemIndex++;
    const tool = itemTool(item);
    const policy = previous
      ? previous.policy
      : tool && resolveToolCallPolicy(tool.name, tool.arguments, { sessionId });
    items.set(item.id, complete ? "completed" : { policy });
    if (item.type === "userMessage") {
      if (previous) return [];
      const event = decodeInput(
        item,
        timestamp ??
          itemTimestamp(turn?.id === turnId ? turn : { id: turnId, startedAt: null }, index),
      );
      const rewindable = !turnsWithInput.has(turnId);
      turnsWithInput.add(turnId);
      return [
        event.type === "user_message" && !rewindable ? { ...event, rewindable: false } : event,
      ];
    }
    if (item.type === "agentMessage" || item.type === "plan")
      return complete && item.text
        ? [{ type: "assistant_message", content: item.text, messageId: item.id }]
        : [];
    const events: SessionEvent[] = [];
    if (item.type === "contextCompaction") {
      if (!previous) events.push({ type: "status", status: "compacting" });
      if (complete) events.push({ type: "status", status: "thinking" });
      return events;
    }
    if (!tool || policy?.kind === "omitted") return [];
    const subagentThread = subagentThreadId(item);
    if (!previous) {
      if (subagentThread)
        subagents.set(subagentThread, {
          toolCallId: item.id,
          project: createCodexProjector(sessionId, subagentThread),
        });
      if (policy?.kind === "translated") events.push(...(policy.projectOnStart ?? []));
      else
        events.push({
          type: "tool_start",
          toolCallId: item.id,
          toolName: tool.name,
          arguments: tool.arguments,
        });
    }
    if (complete && !subagentThread) {
      const result = toolResult(item);
      if (policy?.kind === "translated") events.push(...(policy.projectOnComplete?.(result) ?? []));
      else
        events.push({
          type: "tool_end",
          toolCallId: item.id,
          success: result.success,
          result: result.result,
          details: result.details,
          ...(result.attachments ? { attachments: result.attachments } : {}),
        });
    }
    return events;
  }
}

/** Adapt stored native values without inventing live activity or translating SessionEvents. */
export function codexHistoryEvents(thread: Thread): RpcNotification[] {
  return [
    { method: "thread/started", params: { thread } },
    ...thread.turns.map((turn) => ({
      method: "turn/completed" as const,
      params: { threadId: thread.id, turn },
    })),
    {
      method: "thread/name/updated",
      params: { threadId: thread.id, threadName: thread.name ?? undefined },
    },
  ];
}

/** Stable root-message addresses even when several steers share one native turn. */
export function itemTimestamp(turn: Pick<Turn, "id" | "startedAt">, index: number): string {
  const uuidMillis = /^[0-9a-f]{8}-[0-9a-f]{4}-7/i.test(turn.id)
    ? Number.parseInt(turn.id.replaceAll("-", "").slice(0, 12), 16)
    : 0;
  return new Date((uuidMillis || (turn.startedAt ?? 0) * 1000) + index).toISOString();
}

function itemTool(
  item: ThreadItem,
): { name: string; arguments: ToolCall["arguments"] } | undefined {
  switch (item.type) {
    case "commandExecution":
      return {
        name: "bash",
        arguments: { command: item.command, description: commandDescription(item) },
      };
    case "fileChange":
      return {
        name: "patch",
        arguments: { patch: fileChangesDiff(item.changes) },
      };
    case "dynamicToolCall":
      return {
        name:
          item.namespace && item.namespace !== "toy_box"
            ? `${item.namespace}/${item.tool}`
            : item.tool,
        arguments: recordArguments(item.arguments),
      };
    case "mcpToolCall":
      return {
        name: `${item.server}/${item.tool}`,
        arguments: recordArguments(item.arguments),
      };
    case "subAgentActivity":
      // Activity names the subagent's task path but not its prompt.
      return subagentThreadId(item)
        ? { name: "agent", arguments: { description: item.agentPath.split("/").at(-1) ?? "" } }
        : undefined;
    case "webSearch":
      return { name: "web_search", arguments: { query: item.query } };
    case "imageView":
      return { name: "read", arguments: { path: item.path } };
    // The prompt arrives only with completion, so it is the result rather than an argument.
    case "imageGeneration":
      return { name: "image_generation", arguments: {} };
    default:
      return undefined;
  }
}

function commandDescription(item: Extract<ThreadItem, { type: "commandExecution" }>): string {
  const description = (
    item.commandActions
      .map((action) => {
        switch (action.type) {
          case "read":
            return `Read ${action.name}`;
          case "listFiles":
            return action.path ? `List ${action.path}` : "List files";
          case "search":
            return `${action.query ? `Search for ${action.query}` : "Search files"}${action.path ? ` in ${action.path}` : ""}`;
          case "unknown":
            return `Run ${action.command.trim().split("\n", 1)[0]}`;
        }
      })
      .join("; ") || `Run ${item.command.trim().split("\n", 1)[0]}`
  )
    .replace(/\s+/g, " ")
    .trim();
  return description.length > 120 ? `${description.slice(0, 119)}…` : description;
}

function recordArguments(value: unknown): ToolCall["arguments"] {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ToolCall["arguments"])
    : {};
}

function toolResult(item: ThreadItem): ToolCompletion {
  switch (item.type) {
    case "commandExecution":
      return {
        success: item.exitCode === 0 && item.status === "completed",
        result: item.aggregatedOutput ?? "",
      };
    case "fileChange":
      return {
        success: item.status === "completed",
        result: item.changes.map((change) => change.path).join("\n"),
        details: fileChangesDiff(item.changes),
      };
    case "dynamicToolCall":
      return {
        success: item.success === true,
        result: item.contentItems
          ?.flatMap((content) => (content.type === "inputText" ? [content.text] : []))
          .join("\n"),
      };
    case "mcpToolCall":
      return {
        success: item.status === "completed" && !item.error,
        result: item.result
          ? item.result.content
              .flatMap((content) =>
                content &&
                typeof content === "object" &&
                !Array.isArray(content) &&
                content.type === "text" &&
                typeof content.text === "string"
                  ? [content.text]
                  : [],
              )
              .join("\n")
          : item.error?.message,
      };
    case "imageGeneration":
      return item.status === "completed"
        ? {
            success: true,
            result: item.revisedPrompt ?? "",
            // The built-in tool returns PNG data without a MIME type. Hosts that store generated
            // images send a file reference instead, which this host cannot read.
            ...("result" in item
              ? { attachments: [{ base64: item.result, mimeType: "image/png" }] }
              : {}),
          }
        : {
            success: false,
            result: item.failure
              ? "Image generation usage limit reached."
              : "Image generation failed.",
          };
    default:
      return { success: true };
  }
}
