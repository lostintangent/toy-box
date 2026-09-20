import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AskUserQuestionInput,
  AskUserQuestionOutput,
  FileEditOutput,
  FileWriteOutput,
  TaskCreateOutput,
  TaskUpdateInput,
  TaskUpdateOutput,
  TodoWriteInput,
} from "@anthropic-ai/claude-agent-sdk/sdk-tools";
import type { JSONType } from "zod";
import type { SessionEvent, SessionQuestionBase, TodoItemPatch } from "@sessions/model";
import {
  resolveToolCallPolicy,
  type ToolCallProjectionPolicy,
} from "@sessions/server/toolProjection";
import { decodeInput } from "./messages";
import { fileChangeDetails } from "./fileChanges";

type Arguments = Record<string, JSONType>;
type Call = {
  name: string;
  arguments: Arguments;
  parentToolCallId?: string;
  policy?: Extract<ToolCallProjectionPolicy, { kind: "translated" }>;
  background?: true;
};

export function claudeQuestions(input: AskUserQuestionInput): SessionQuestionBase[] {
  return input.questions.map(({ question, options }) => ({
    question,
    choices: options.map(({ label }) => label),
    allowFreeform: true,
  }));
}

/** The same projection consumes SDK streaming messages and SDK-reconstructed native history. */
export function createClaudeProjector(sessionId: string): (message: SDKMessage) => SessionEvent[] {
  const calls = new Map<string, Call>();
  let streamingId: string | undefined;
  let assistantId: string | undefined;
  let assistantText = "";

  return (message) => {
    const parentToolCallId =
      "parent_tool_use_id" in message ? (message.parent_tool_use_id ?? undefined) : undefined;
    switch (message.type) {
      case "system":
        if (message.subtype === "task_started" && message.tool_use_id && message.is_backgrounded) {
          const call = calls.get(message.tool_use_id);
          if (call && (call.name === "Agent" || call.name === "Task")) call.background = true;
        }
        if (message.subtype === "task_notification" && message.tool_use_id) {
          const call = calls.get(message.tool_use_id);
          if (call?.background) {
            calls.delete(message.tool_use_id);
            return [
              {
                type: "tool_end",
                toolCallId: message.tool_use_id,
                parentToolCallId: call.parentToolCallId,
                success: message.status === "completed",
                result: message.summary,
              },
            ];
          }
        }
        if (message.subtype === "session_state_changed" && message.state === "idle")
          return [{ type: "end", reason: "idle" }];
        if (message.subtype === "status")
          return [
            { type: "status", status: message.status === "compacting" ? "compacting" : "thinking" },
          ];
        if (message.subtype === "thinking_tokens") return [{ type: "status", status: "reasoning" }];
        if (message.subtype === "init")
          return [{ type: "model_changed", model: { provider: "claude", name: message.model } }];
        return [];
      case "result":
        return message.is_error && !message.terminal_reason?.startsWith("aborted_")
          ? [
              {
                type: "end",
                reason: "error",
                error: message.subtype === "success" ? message.result : message.errors.join("\n"),
              },
            ]
          : [];
      case "stream_event": {
        const event = message.event;
        if (event.type === "message_start" && !parentToolCallId) streamingId = event.message.id;
        if (event.type === "content_block_start" && event.content_block.type === "thinking")
          return [{ type: "reasoning", content: event.content_block.thinking, parentToolCallId }];
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta" && !parentToolCallId)
            return [{ type: "delta", content: event.delta.text, messageId: streamingId }];
          if (event.delta.type === "thinking_delta")
            return [{ type: "reasoning_delta", content: event.delta.thinking, parentToolCallId }];
        }
        return [];
      }
      case "assistant": {
        const events: SessionEvent[] = [
          {
            type: "model_changed",
            model: {
              provider: "claude",
              name: message.message.model,
              ...("effort" in message && typeof message.effort === "string"
                ? { reasoningEffort: message.effort }
                : {}),
            },
            parentToolCallId,
          },
        ];
        for (const block of message.message.content) {
          if (block.type === "text") {
            if (parentToolCallId)
              events.push({ type: "assistant_message", content: block.text, parentToolCallId });
            else {
              if (assistantId !== message.message.id) {
                assistantId = message.message.id;
                assistantText = "";
              }
              assistantText += block.text;
              events.push({
                type: "assistant_message",
                content: assistantText,
                messageId: assistantId,
              });
            }
          } else if (block.type === "thinking" && block.thinking) {
            events.push({ type: "reasoning", content: block.thinking, parentToolCallId });
          } else if (block.type === "tool_use") {
            if (block.name === "ToolSearch") continue;
            const args = block.input as Arguments;
            const name = toolName(block.name);
            const arguments_ = toolArguments(block.name, args);
            const policy = resolveToolCallPolicy(name, arguments_, { sessionId });
            if (policy?.kind === "omitted") continue;
            calls.set(block.id, { name: block.name, arguments: args, parentToolCallId, policy });
            if (block.name === "AskUserQuestion") {
              for (const [index, question] of claudeQuestions(
                args as unknown as AskUserQuestionInput,
              ).entries())
                events.push({
                  type: "tool_start",
                  toolName: "ask_user",
                  toolCallId: `${block.id}:${index}`,
                  arguments: {},
                  question,
                });
            } else if (isChecklistTool(block.name)) continue;
            else if (policy) events.push(...(policy.projectOnStart ?? []));
            else
              events.push({
                type: "tool_start",
                toolName: name,
                toolCallId: block.id,
                arguments: arguments_,
                parentToolCallId,
              });
          }
        }
        return events;
      }
      case "user": {
        const content = message.message.content;
        // Claude persists interruption notices as user text without isSynthetic or origin.
        if (
          !message.origin &&
          Array.isArray(content) &&
          content.length === 1 &&
          content[0]?.type === "text" &&
          /^\[Request interrupted by user(?: for tool use)?\]$/.test(content[0].text)
        )
          return [];
        const results =
          typeof content === "string"
            ? []
            : content.filter((block) => block.type === "tool_result");
        if (!results.length)
          return parentToolCallId ||
            message.isSynthetic ||
            message.origin?.kind === "task-notification"
            ? []
            : [decodeInput(content, message.uuid, message.timestamp)];
        return results.flatMap((result): SessionEvent[] => {
          const call = calls.get(result.tool_use_id);
          if (!call) return [];
          // A live background launch completes on task_notification. History has only
          // the durable launch result and child transcript, without task_started.
          if (call.background && !result.is_error) return [];
          calls.delete(result.tool_use_id);
          const success = !result.is_error;
          const text = contentText(result.content);
          const output = message.tool_use_result;
          if (call.name === "AskUserQuestion") {
            const questions = claudeQuestions(call.arguments as unknown as AskUserQuestionInput);
            const answers = (output as AskUserQuestionOutput | undefined)?.answers;
            return questions.map((question, index) =>
              answers?.[question.question] !== undefined
                ? {
                    type: "question_resolved",
                    toolCallId: `${result.tool_use_id}:${index}`,
                    answer: answers[question.question]!,
                  }
                : { type: "question_cancelled", toolCallId: `${result.tool_use_id}:${index}` },
            );
          }
          if (isChecklistTool(call.name))
            return success && !call.parentToolCallId
              ? [{ type: "todos_patch", patches: checklistPatches(call, output) }]
              : [];
          const completion = {
            success,
            result: text,
            ...(success && (call.name === "Edit" || call.name === "Write") && output
              ? { details: fileChangeDetails(output as FileEditOutput | FileWriteOutput) }
              : {}),
          };
          return call.policy
            ? (call.policy.projectOnComplete?.(completion) ?? [])
            : [
                {
                  type: "tool_end",
                  toolCallId: result.tool_use_id,
                  parentToolCallId: call.parentToolCallId,
                  ...completion,
                },
              ];
        });
      }
      default:
        return [];
    }
  };
}

function toolName(name: string): string {
  if (name.startsWith("mcp__toy_box__")) return name.slice("mcp__toy_box__".length);
  return (
    (
      {
        Bash: "bash",
        Read: "read",
        Edit: "edit",
        Write: "edit",
        Glob: "glob",
        Grep: "grep",
        WebSearch: "grep",
        WebFetch: "fetch",
        Agent: "agent",
        Task: "agent",
        Skill: "skill",
      } as Record<string, string>
    )[name] ?? name
  );
}

function toolArguments(name: string, args: Arguments): Arguments {
  if (name === "Read" || name === "Edit" || name === "Write")
    return { ...args, path: args.file_path };
  if (name === "Agent" || name === "Task")
    return {
      ...args,
      agent_type: args.subagent_type ?? "general-purpose",
      mode: args.run_in_background ? "background" : "sync",
    };
  return args;
}

function contentText(
  content: string | ReadonlyArray<{ type: string; text?: string }> | undefined,
): string {
  return typeof content === "string"
    ? content
    : (content ?? []).flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

function isChecklistTool(name: string): boolean {
  return name === "TodoWrite" || name === "TaskCreate" || name === "TaskUpdate";
}

function checklistPatches(call: Call, output: unknown): TodoItemPatch[] {
  if (call.name === "TodoWrite")
    return [
      {
        type: "replace_all",
        items: (call.arguments as unknown as TodoWriteInput).todos.map((todo, index) => ({
          id: String(index),
          title: todo.content,
          status: todo.status === "completed" ? "done" : todo.status,
        })),
      },
    ];
  if (call.name === "TaskCreate") {
    const task = (output as TaskCreateOutput | undefined)?.task;
    return task ? [{ type: "upsert", id: task.id, title: task.subject, status: "pending" }] : [];
  }
  const args = call.arguments as unknown as TaskUpdateInput;
  const update = output as TaskUpdateOutput | undefined;
  if (!update?.success) return [];
  return args.status === "deleted"
    ? [{ type: "delete", id: update.taskId }]
    : [
        {
          type: "upsert",
          id: update.taskId,
          ...(args.subject ? { title: args.subject } : {}),
          ...(args.status ? { status: args.status === "completed" ? "done" : args.status } : {}),
        },
      ];
}
