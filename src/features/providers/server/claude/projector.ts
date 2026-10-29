import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  AskUserQuestionInput,
  AskUserQuestionOutput,
  FileEditOutput,
  FileWriteOutput,
  TaskCreateOutput,
  TaskUpdateInput,
  TaskUpdateOutput,
} from "@anthropic-ai/claude-agent-sdk/sdk-tools";
import type { JSONType } from "zod";
import type { ModelConfiguration } from "@providers/model";
import type { SessionEvent, SessionQuestionBase, TodoItemPatch } from "@sessions/model";
import {
  resolveToolCallPolicy,
  type ToolCallProjectionPolicy,
} from "@sessions/server/toolProjection";
import { decodeInput } from "./messages";
import { fileChangeDetails } from "./fileChanges";
import { normalizeModelId } from "./models";

type Arguments = Record<string, JSONType>;

/** A native tool call between its `tool_use` and its `tool_result`. */
type Call = {
  name: string;
  arguments: Arguments;
  parentToolCallId?: string;
  policy?: Extract<ToolCallProjectionPolicy, { kind: "translated" }>;
  background?: true;
};

// The CLI writes interruption notices and local command output as user text without an origin.
// Neither is transcript. Commands themselves are owner input: a send's replay must always be
// transcript, because Sessions' queue waits for it.
const CLI_TEXT =
  /^(?:\[Request interrupted by user(?: for tool use)?\]$|<local-command-std(?:out|err)>)/;

// Native tools as Toy Box's canonical tools. Glob and Grep exist only on npm and Windows builds;
// native macOS and Linux builds search through Bash.
const TOOL_NAMES: Record<string, string> = {
  Bash: "bash",
  Read: "read",
  Edit: "edit",
  Write: "edit",
  Glob: "glob",
  Grep: "grep",
  WebFetch: "fetch",
  WebSearch: "web_search",
  Agent: "agent",
  Skill: "skill",
};

/** Each native question is its own domain question and tool call. */
export function claudeQuestions(
  toolUseId: string,
  input: AskUserQuestionInput,
): { toolCallId: string; question: SessionQuestionBase }[] {
  return input.questions.map(({ question, options }, index) => ({
    toolCallId: `${toolUseId}:${index}`,
    question: { question, choices: options.map(({ label }) => label), allowFreeform: true },
  }));
}

/** The same projection consumes SDK streaming messages and SDK-reconstructed native history. */
export function createClaudeProjector(sessionId: string): (message: SDKMessage) => SessionEvent[] {
  const calls = new Map<string, Call>();
  // Every native message restates its model; the main thread and each subagent change separately.
  const models = new Map<string | undefined, string>();
  // The main thread's current native message and its committed text.
  let assistantId: string | undefined;
  let assistantText = "";
  // The main thread's context as its latest request sent it, and the model whose context window
  // each turn's result reports.
  let mainContext: { model: string; tokens: number } | undefined;

  return (message) => {
    const parentToolCallId =
      "parent_tool_use_id" in message ? (message.parent_tool_use_id ?? undefined) : undefined;
    switch (message.type) {
      case "system":
        switch (message.subtype) {
          case "init":
            // Each turn's init restates the native model, even after Sessions applied its own.
            models.delete(undefined);
            return modelChanged({ provider: "claude", name: normalizeModelId(message.model) });
          case "status":
            return [
              {
                type: "status",
                status: message.status === "compacting" ? "compacting" : "thinking",
              },
            ];
          case "session_state_changed":
            return message.state === "idle" ? [{ type: "end", reason: "idle" }] : [];
          case "task_started":
            if (message.tool_use_id && message.is_backgrounded) {
              const call = calls.get(message.tool_use_id);
              if (call?.name === "Agent") call.background = true;
            }
            return [];
          case "task_notification": {
            const id = message.tool_use_id;
            const call = id ? calls.get(id) : undefined;
            if (!id || !call?.background) return [];
            calls.delete(id);
            return [
              {
                type: "tool_end",
                toolCallId: id,
                parentToolCallId: call.parentToolCallId,
                success: message.status === "completed",
                result: message.summary,
              },
            ];
          }
          case "compact_boundary":
            // A compaction's own count omits the system prompt and tools, so the compacted
            // context is unknown until a request reports it.
            mainContext = undefined;
            return [];
          default:
            return [];
        }
      case "result": {
        const windows = new Map(
          Object.entries(message.modelUsage ?? {}).map(([model, usage]) => [
            normalizeModelId(model),
            usage.contextWindow,
          ]),
        );
        const tokenWindow = mainContext && windows.get(mainContext.model);
        const usage: SessionEvent[] =
          mainContext && tokenWindow
            ? [
                {
                  type: "context_usage_changed",
                  usage: { tokens: mainContext.tokens, tokenWindow },
                },
              ]
            : [];
        return message.is_error && !message.terminal_reason?.startsWith("aborted_")
          ? [
              ...usage,
              {
                type: "end",
                reason: "error",
                error: message.subtype === "success" ? message.result : message.errors.join("\n"),
              },
            ]
          : usage;
      }
      case "stream_event": {
        const event = message.event;
        if (event.type === "message_start" && !parentToolCallId) {
          assistantId = event.message.id;
          assistantText = "";
        }
        if (event.type === "content_block_start" && event.content_block.type === "thinking")
          return [{ type: "reasoning", content: event.content_block.thinking, parentToolCallId }];
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta" && !parentToolCallId)
            return [{ type: "delta", content: event.delta.text, messageId: assistantId }];
          if (event.delta.type === "thinking_delta")
            return [{ type: "reasoning_delta", content: event.delta.thinking, parentToolCallId }];
        }
        return [];
      }
      case "assistant": {
        // The CLI authors API errors and notices as `<synthetic>` model messages. They are neither
        // model output nor a model change; a turn that fails reports its error in its result.
        if (message.message.model === "<synthetic>") return [];
        const usage = message.message.usage;
        if (!parentToolCallId && usage)
          mainContext = {
            model: normalizeModelId(message.message.model),
            tokens:
              usage.input_tokens +
              (usage.cache_read_input_tokens ?? 0) +
              (usage.cache_creation_input_tokens ?? 0) +
              usage.output_tokens,
          };
        const events = modelChanged(
          {
            provider: "claude",
            name: normalizeModelId(message.message.model),
            ...("effort" in message && typeof message.effort === "string"
              ? { reasoningEffort: message.effort }
              : {}),
          },
          parentToolCallId,
        );
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
          } else if (block.type === "thinking" && block.thinking)
            events.push({ type: "reasoning", content: block.thinking, parentToolCallId });
          else if (block.type === "tool_use")
            events.push(
              ...startCall(block.id, block.name, block.input as Arguments, parentToolCallId),
            );
        }
        return events;
      }
      case "user": {
        const content = message.message.content;
        if (!message.origin && CLI_TEXT.test(contentText(content))) return [];
        if (typeof content !== "string" && content.some((block) => block.type === "tool_result"))
          return content.flatMap((block) =>
            block.type === "tool_result"
              ? completeCall(
                  block.tool_use_id,
                  !block.is_error,
                  contentText(block.content),
                  message.tool_use_result,
                )
              : [],
          );
        return parentToolCallId ||
          message.isSynthetic ||
          message.origin?.kind === "task-notification"
          ? []
          : [decodeInput(content, message.uuid, message.timestamp)];
      }
      default:
        return [];
    }
  };

  function modelChanged(model: ModelConfiguration, parentToolCallId?: string): SessionEvent[] {
    const key = `${model.name} ${model.reasoningEffort ?? ""}`;
    if (models.get(parentToolCallId) === key) return [];
    models.set(parentToolCallId, key);
    return [{ type: "model_changed", model, parentToolCallId }];
  }

  function startCall(
    id: string,
    nativeName: string,
    args: Arguments,
    parentToolCallId?: string,
  ): SessionEvent[] {
    if (nativeName === "ToolSearch") return [];
    const name = toolName(nativeName);
    const arguments_ = toolArguments(nativeName, args, parentToolCallId);
    const policy = resolveToolCallPolicy(name, arguments_, { sessionId });
    if (policy?.kind === "omitted") return [];
    calls.set(id, { name: nativeName, arguments: args, parentToolCallId, policy });
    if (nativeName === "AskUserQuestion")
      return claudeQuestions(id, args as unknown as AskUserQuestionInput).map(
        ({ toolCallId, question }): SessionEvent => ({
          type: "tool_start",
          toolName: "ask_user",
          toolCallId,
          arguments: {},
          question,
        }),
      );
    if (isChecklistTool(nativeName)) return [];
    if (policy) return policy.projectOnStart ?? [];
    return [
      {
        type: "tool_start",
        toolName: name,
        toolCallId: id,
        arguments: arguments_,
        parentToolCallId,
      },
    ];
  }

  function completeCall(
    id: string,
    success: boolean,
    result: string,
    output: unknown,
  ): SessionEvent[] {
    const call = calls.get(id);
    // A live background launch completes on task_notification. History has only
    // the durable launch result and child transcript, without task_started.
    if (!call || (call.background && success)) return [];
    calls.delete(id);
    if (call.name === "AskUserQuestion") {
      const answers = (output as AskUserQuestionOutput | undefined)?.answers;
      return claudeQuestions(id, call.arguments as unknown as AskUserQuestionInput).map(
        ({ toolCallId, question }): SessionEvent => {
          const answer = answers?.[question.question];
          return answer === undefined
            ? { type: "question_cancelled", toolCallId }
            : { type: "question_resolved", toolCallId, answer };
        },
      );
    }
    if (isChecklistTool(call.name))
      return success && !call.parentToolCallId
        ? [{ type: "todos_patch", patches: checklistPatches(call, output) }]
        : [];
    const completion = {
      success,
      result,
      ...(success && (call.name === "Edit" || call.name === "Write") && output
        ? { details: fileChangeDetails(output as FileEditOutput | FileWriteOutput) }
        : {}),
    };
    return call.policy
      ? (call.policy.projectOnComplete?.(completion) ?? [])
      : [
          {
            type: "tool_end",
            toolCallId: id,
            parentToolCallId: call.parentToolCallId,
            ...completion,
          },
        ];
  }
}

function toolName(name: string): string {
  return name.startsWith("mcp__toy_box__")
    ? name.slice("mcp__toy_box__".length)
    : (TOOL_NAMES[name] ?? name);
}

function toolArguments(name: string, args: Arguments, parentToolCallId?: string): Arguments {
  if (name === "Read" || name === "Edit" || name === "Write")
    return { ...args, path: args.file_path };
  if (name === "Agent")
    return {
      ...args,
      agent_type: args.subagent_type ?? "general-purpose",
      // Unless the call says otherwise, the main thread's agents run in the background and a
      // subagent's own agents in the foreground.
      mode: (args.run_in_background ?? !parentToolCallId) ? "background" : "sync",
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
  return name === "TaskCreate" || name === "TaskUpdate";
}

function checklistPatches(call: Call, output: unknown): TodoItemPatch[] {
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
