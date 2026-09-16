// Live notifications and history-derived inputs share one event projector.
// Native item IDs own deduplication; deltas preview authoritative completions.
import type { SessionEvent, ToolCall } from "@sessions/model";
import {
  resolveToolCallPolicy,
  type ToolCallProjectionPolicy,
  type ToolCompletion,
} from "@sessions/server/toolProjection";
import type {
  AgentMessageDeltaNotification,
  ItemCompletedNotification,
  ReasoningTextDeltaNotification,
  Thread,
  ThreadItem,
  ThreadNameUpdatedNotification,
  ThreadStartedNotification,
  ToolRequestUserInputParams,
  Turn,
  TurnCompletedNotification,
  TurnPlanUpdatedNotification,
  TurnStartedNotification,
} from "./protocol";
import type { RpcNotification, RpcRequest } from "./protocol/transport";
import { decodeInput } from "./inputs";
import { fileChangesDiff } from "./fileChanges";

export function createCodexProjector(sessionId: string) {
  const turnsWithInput = new Set<string>();
  const items = new Map<string, "completed" | { policy?: ToolCallProjectionPolicy }>();
  let turn: Pick<Turn, "id" | "startedAt"> | undefined;
  let itemIndex = 0;

  return (event: RpcNotification | RpcRequest): SessionEvent[] => {
    const { method, params } = event;
    const events: SessionEvent[] = [];
    switch (method) {
      case "thread/started": {
        const { thread } = params as ThreadStartedNotification;
        if (thread.model)
          events.push({
            type: "model_changed",
            model: {
              provider: "codex",
              name: thread.model,
              ...(thread.reasoningEffort ? { reasoningEffort: thread.reasoningEffort } : {}),
            },
          });
        break;
      }
      case "turn/started":
        turn = (params as TurnStartedNotification).turn;
        itemIndex = 0;
        return [{ type: "status", status: "thinking" }];
      case "turn/completed": {
        const { turn } = params as TurnCompletedNotification;
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
        const { item, turnId } = params as ItemCompletedNotification;
        return projectItem(item, turnId, method === "item/completed");
      }
      case "item/agentMessage/delta": {
        const { delta, itemId } = params as AgentMessageDeltaNotification;
        return delta ? [{ type: "delta", content: delta, messageId: itemId }] : [];
      }
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        const { delta } = params as ReasoningTextDeltaNotification;
        return delta ? [{ type: "reasoning", content: delta }] : [];
      }
      case "turn/plan/updated":
        events.push({
          type: "todos_patch",
          patches: [
            {
              type: "replace_all",
              items: (params as TurnPlanUpdatedNotification).plan.map((step, index) => ({
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
        const name = (params as ThreadNameUpdatedNotification).threadName;
        return name ? [{ type: "session_title_changed", title: name }] : [];
      }
      case "item/tool/requestUserInput": {
        if (!("id" in event)) throw new Error("Codex user input request is missing its ID.");
        const input = params as ToolRequestUserInputParams;
        for (const question of input.questions) {
          const toolCallId = `${input.itemId}:${question.id}`;
          const domainQuestion = {
            question: question.question,
            choices: question.options?.map((option) => option.label),
            allowFreeform: question.isOther || !question.options?.length,
            blocking: input.isBlocking,
            secret: question.isSecret,
          };
          events.push(
            {
              type: "tool_start",
              toolCallId,
              toolName: "ask_user",
              arguments: {},
              question: domainQuestion,
            },
            {
              type: "question_requested",
              toolCallId,
              requestId: codexQuestionId(event.id, question.id),
              question: domainQuestion,
            },
          );
        }
        break;
      }
    }
    return events;
  };

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
    if (!previous) {
      if (policy?.kind === "translated") events.push(...(policy.projectOnStart ?? []));
      else
        events.push({
          type: "tool_start",
          toolCallId: item.id,
          toolName: tool.name,
          arguments: tool.arguments,
        });
    }
    if (complete) {
      const result = toolResult(item);
      if (policy?.kind === "translated") events.push(...(policy.projectOnComplete?.(result) ?? []));
      else
        events.push({
          type: "tool_end",
          toolCallId: item.id,
          success: result.success,
          result: result.result,
          details: result.details,
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
      method: "turn/completed",
      params: { threadId: thread.id, turn },
    })),
    {
      method: "thread/name/updated",
      params: { threadId: thread.id, threadName: thread.name },
    },
  ];
}

export function codexQuestionId(rpcId: string | number, questionId: string): string {
  return `codex:${rpcId}:${questionId}`;
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
    case "collabAgentToolCall":
      return { name: "agent", arguments: { prompt: item.prompt ?? "", description: item.tool } };
    case "webSearch":
      return { name: "web_search", arguments: { query: item.query } };
    case "imageView":
      return { name: "read", arguments: { path: item.path } };
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
    case "collabAgentToolCall":
      return { success: item.status === "completed", result: JSON.stringify(item.agentsStates) };
    default:
      return { success: true };
  }
}
