// Canonical session state reducer — the single transition function for
// Session state. Three consumers feed it the same SessionEvents:
//   - server live streaming (SessionStream#emit, server/runtime/sessionStream.ts)
//   - server history replay (server/state/snapshots.ts)
//   - the client, for live SSE events and the buffered-event replay a
//     late-connecting client catches up on (useSession#applyEvent)
// Sharing this module is what guarantees a transcript renders identically
// whether it is watched live, reloaded, or reconnected to. It stays agnostic
// to native SDK details — translation policy lives in Providers.
//
// Vocabulary used throughout this file:
//   - root vs child-scoped: events without a parentToolCallId mutate the top-level
//     transcript; events carrying one mutate the subagent state nested under
//     the spawning agent tool call (toolCall.subagent).
//   - message group / boundary: an assistant turn renders as alternating
//     text and tool-call groups. A boundary — the first text delta after
//     tool calls (live), or a committed root assistant_message (replay) —
//     finalizes the current group and starts a fresh assistant message.
//
// Identity contract: each event returns a new SessionState with structural sharing.
// Every changed render-visible branch gets a new identity, while unchanged
// messages and nested tool calls retain theirs. This lets clients batch when
// they publish state to React without obscuring what changed.

import { workspaceFileId, type WorkspaceFile } from "@files/model";
import { hasBlockingSessionQuestion } from "./questions";
import type {
  SessionCanvas,
  SessionEvent,
  Message,
  SessionQuestion,
  SessionQuestionBase,
  SessionState,
  SubagentActivity,
  TodoItem,
  TodoItemPatch,
  ToolCall,
} from "./index";

// ============================================================================
// Public API
// ============================================================================

export function createInitialSessionState(initial: Partial<SessionState> = {}): SessionState {
  return {
    messages: initial.messages ? [...initial.messages] : [],
    queuedMessages: initial.queuedMessages ? [...initial.queuedMessages] : [],
    todos: initial.todos ? initial.todos.map((todo) => ({ ...todo })) : [],
    linkedSessionIds: initial.linkedSessionIds ? [...initial.linkedSessionIds] : [],
    canvases: initial.canvases ? initial.canvases.map((canvas) => ({ ...canvas })) : [],
    artifacts: initial.artifacts ? [...initial.artifacts] : [],
    openedFiles: initial.openedFiles ? [...initial.openedFiles] : [],
    status: initial.status ?? "idle",
    reasoningContent: initial.reasoningContent ?? "",
    model: initial.model,
    ...(initial.lastSeenEventId !== undefined ? { lastSeenEventId: initial.lastSeenEventId } : {}),
  };
}

/** Rebuild idle state from provider history, clearing any trailing live state. */
export function replaySessionHistory(events: readonly SessionEvent[]): SessionState {
  return applySessionEvent(events.reduce(applySessionEvent, createInitialSessionState()), {
    type: "end",
    reason: "idle",
  });
}

/** Reduce one canonical event into a new SessionState. The switch mutates only this
 *  fresh shallow root; helpers replace every nested branch they change. */
export function applySessionEvent(state: SessionState, event: SessionEvent): SessionState {
  const next = { ...state };
  applySessionEventCore(next, event);
  return next;
}

// ============================================================================
// Event reducer
// ============================================================================

function applySessionEventCore(state: SessionState, event: SessionEvent): void {
  // Replayed buffer events that are already incorporated in a snapshot
  // can race with detail refetches; skip stale events before mutating state.
  if (
    event.eventId !== undefined &&
    state.lastSeenEventId !== undefined &&
    event.eventId <= state.lastSeenEventId
  ) {
    return;
  }
  if (event.eventId !== undefined) state.lastSeenEventId = event.eventId;

  switch (event.type) {
    // ── Messages ──────────────────────────────────────────────────────

    case "user_message": {
      upsertUserMessage(state, event);
      return;
    }

    case "system_message": {
      if (event.clientId) removeQueuedMessage(state, event.clientId);
      appendMessage(state, inputMessageFromEvent(event));
      return;
    }

    case "assistant_message": {
      if (event.parentToolCallId) {
        updateSubagentActivity(state, event.parentToolCallId, (activity) => ({
          ...activity,
          content: appendCommittedSubagentContent(activity.content ?? "", event.content),
        }));
        return;
      }

      // A committed message closes the current tool group. Native IDs select
      // its streamed preview; older events fall back to activity status.
      const reconcileLiveMessage =
        state.status === "thinking" ||
        state.status === "reasoning" ||
        state.status === "responding";

      upsertCommittedAssistantMessage(state, event.content, reconcileLiveMessage, event.messageId);
      if (reconcileLiveMessage && event.content) {
        state.status = "responding";
        state.reasoningContent = "";
      }
      return;
    }

    case "message_queued": {
      upsertQueuedMessage(state, { ...event.message, status: "queued" });
      return;
    }

    case "message_status_changed": {
      setQueuedMessageStatus(state, event.clientId, event.status);
      return;
    }

    case "message_cancelled": {
      removeQueuedMessage(state, event.clientId);
      return;
    }

    // ── Streaming content ─────────────────────────────────────────────

    case "status": {
      state.status = event.status;
      state.reasoningContent = "";
      return;
    }

    case "delta": {
      // Empty deltas carry no content and must not create a message boundary.
      if (event.content.length === 0) return;

      ensureCleanAssistantMessage(state, event.messageId);
      state.status = "responding";
      state.reasoningContent = "";
      appendAssistantDelta(state, event.content);
      return;
    }

    case "reasoning": {
      if (event.parentToolCallId) {
        updateSubagentActivity(state, event.parentToolCallId, (activity) => ({
          ...activity,
          reasoningContent: mergeStreamingText(activity.reasoningContent ?? "", event.content),
        }));
        return;
      }

      state.status = "reasoning";
      state.reasoningContent = mergeStreamingText(state.reasoningContent, event.content);
      return;
    }

    // ── Tool calls ────────────────────────────────────────────────────

    case "tool_start": {
      if (event.parentToolCallId) {
        // Nest subagent tool calls under their agent call.
        const child: ToolCall = {
          id: event.toolCallId,
          name: event.toolName,
          arguments: event.arguments,
        };
        updateSubagentActivity(state, event.parentToolCallId, (activity) => ({
          ...activity,
          toolCalls: activity.toolCalls ? [...activity.toolCalls, child] : [child],
        }));
        return;
      }

      ensureAssistantMessage(state);
      upsertToolCallOnLastAssistant(state, {
        id: event.toolCallId,
        name: event.toolName,
        arguments: event.arguments,
        ...(event.question ? { question: { ...event.question, state: "unanswered" } } : {}),
      });
      return;
    }

    case "tool_end": {
      const result = {
        content: event.result ?? "",
        success: event.success,
        details: event.details,
      };

      if (event.parentToolCallId) {
        // Complete a child tool call nested under its agent call.
        updateSubagentToolCall(state, event.parentToolCallId, event.toolCallId, (toolCall) => ({
          ...toolCall,
          result,
        }));
        return;
      }

      // Deferred completions can arrive after a message boundary, so search
      // the transcript rather than assuming the call is on the last message.
      updateToolCall(state, event.toolCallId, (toolCall) => ({
        ...toolCall,
        result,
      }));
      return;
    }

    case "question_requested": {
      updateQuestion(state, event.toolCallId, (toolCall) => ({
        ...toolCall,
        question: {
          ...event.question,
          state: "pending",
          requestId: event.requestId,
        },
      }));
      return;
    }

    case "question_resolved": {
      updateQuestion(state, event.toolCallId, (toolCall) => {
        if (!toolCall.question) return toolCall;
        return {
          ...toolCall,
          question: {
            ...toQuestionBase(toolCall.question),
            state: "answered",
            answer: event.answer,
          },
        };
      });
      return;
    }

    case "question_cancelled": {
      updateQuestion(state, event.toolCallId, (toolCall) =>
        toolCall.question?.state === "pending"
          ? { ...toolCall, question: { ...toQuestionBase(toolCall.question), state: "unanswered" } }
          : toolCall,
      );
      return;
    }

    // ── Status & metadata ─────────────────────────────────────────────

    case "session_title_changed":
      // Session titles belong to workspace metadata, not reduced transcript state.
      return;

    case "todos_patch": {
      state.todos = applyTodoPatches(state.todos, event.patches);
      return;
    }

    // ── Linked sessions ───────────────────────────────────────────────

    case "linked_session_added": {
      if (state.linkedSessionIds.includes(event.sessionId)) return;
      state.linkedSessionIds = [...state.linkedSessionIds, event.sessionId];
      return;
    }

    case "linked_session_removed": {
      const filtered = state.linkedSessionIds.filter((id) => id !== event.sessionId);
      if (filtered.length === state.linkedSessionIds.length) return;
      state.linkedSessionIds = filtered;
      return;
    }

    // ── Canvases ────────────────────────────────────────────────────────

    case "canvas_opened": {
      upsertCanvas(state, event.canvas);
      return;
    }

    // ── Artifacts ─────────────────────────────────────────────────────

    case "artifacts_changed": {
      if (
        event.artifacts.length === state.artifacts.length &&
        event.artifacts.every((path, index) => path === state.artifacts[index])
      )
        return;
      state.artifacts = [...event.artifacts];
      return;
    }

    case "file_opened": {
      openFile(state, event.file);
      return;
    }

    case "file_closed": {
      closeFile(state, event.file);
      return;
    }

    // ── Model ─────────────────────────────────────────────────────────

    case "model_changed":
      if (event.parentToolCallId) {
        updateSubagentActivity(state, event.parentToolCallId, (activity) => ({
          ...activity,
          model: event.model,
        }));
        return;
      }

      state.model = event.model;
      return;

    // ── Lifecycle ─────────────────────────────────────────────────────

    case "end":
      state.messages = markPendingQuestionUnanswered(state.messages);
      if (state.queuedMessages.length > 0) state.queuedMessages = [];
      // Idempotent on purpose: clients can synthesize fallback end events for
      // event-less completions/transport failures, and replays can deliver one
      // after state is already final.
      if (event.reason === "error") {
        finishWithError(state, event.error);
        return;
      }

      if (state.status === "idle" && state.reasoningContent === "") {
        return;
      }
      state.status = "idle";
      state.reasoningContent = "";
      return;

    default:
      event satisfies never;
      return;
  }
}

function finishWithError(state: SessionState, error?: string): void {
  const message = state.messages[state.messages.length - 1];
  const errorContent =
    error ||
    (message?.role === "assistant" && message.error) ||
    "An error occurred. Please try again.";
  if (message?.role === "assistant") {
    replaceMessage(state, state.messages.length - 1, {
      ...message,
      error: errorContent,
    });
  } else {
    appendMessage(state, {
      role: "assistant",
      content: "",
      error: errorContent,
    });
  }

  state.status = "idle";
  state.reasoningContent = "";
}

// ============================================================================
// Canvas and artifact helpers
// ============================================================================

function createCanvasKey(
  canvas: Pick<SessionCanvas, "extensionId" | "canvasId" | "instanceId">,
): string {
  return JSON.stringify([canvas.extensionId ?? null, canvas.canvasId, canvas.instanceId]);
}

function upsertCanvas(state: SessionState, canvas: Omit<SessionCanvas, "key" | "revision">): void {
  const key = createCanvasKey(canvas);
  const index = state.canvases.findIndex((candidate) => candidate.key === key);

  if (index === -1) {
    state.canvases = [...state.canvases, { ...canvas, key, revision: 1 }];
    return;
  }

  const current = state.canvases[index];
  const next = [...state.canvases];
  next[index] = {
    ...canvas,
    key,
    revision: current.revision + 1,
  };
  state.canvases = next;
}

function openFile(state: SessionState, file: WorkspaceFile): void {
  const id = workspaceFileId(file);
  if (state.openedFiles.some((opened) => workspaceFileId(opened) === id)) return;
  state.openedFiles = [...state.openedFiles, file];
}

function closeFile(state: SessionState, file: WorkspaceFile): void {
  const id = workspaceFileId(file);
  const openedFiles = state.openedFiles.filter((opened) => workspaceFileId(opened) !== id);
  if (openedFiles.length === state.openedFiles.length) return;
  state.openedFiles = openedFiles;
}

// ============================================================================
// Message helpers
// ============================================================================

type InputEvent = Extract<SessionEvent, { type: "user_message" | "system_message" }>;
type InputMessage = Extract<Message, { role: "user" | "system" }>;

function inputMessageFromEvent(event: InputEvent): InputMessage {
  return event.type === "user_message"
    ? {
        role: "user",
        ...(event.clientId ? { clientId: event.clientId } : {}),
        content: event.content,
        attachments: event.attachments,
        ...(event.rewindable === false ? { rewindable: false } : {}),
        timestamp: event.timestamp,
      }
    : {
        role: "system",
        ...(event.clientId ? { clientId: event.clientId } : {}),
        content: event.content,
        timestamp: event.timestamp,
      };
}

/** One client ID identifies a user input while queued, optimistically
 *  rendered, and canonically echoed. Canonical data replaces an existing
 *  transcript entry; otherwise the input moves from the queue into history. */
function upsertUserMessage(
  state: SessionState,
  event: Extract<SessionEvent, { type: "user_message" }>,
): void {
  if (event.clientId) removeQueuedMessage(state, event.clientId);
  const message = inputMessageFromEvent(event);
  const index = event.clientId
    ? state.messages.findIndex(
        (candidate) => candidate.role === "user" && candidate.clientId === event.clientId,
      )
    : -1;
  if (index === -1) appendMessage(state, message);
  else replaceMessage(state, index, message);
}

function ensureAssistantMessage(state: SessionState): void {
  const last = state.messages[state.messages.length - 1];
  if (last?.role === "assistant" && !last.error) return;
  appendMessage(state, {
    role: "assistant",
    content: "",
  });
}

// Like ensureAssistantMessage, but also starts a new message when the current
// one already has tool calls — so that text after tool execution lands on a
// fresh assistant message, preserving the interleaving of text and tool groups.
function ensureCleanAssistantMessage(state: SessionState, messageId?: string): void {
  const last = state.messages[state.messages.length - 1];
  if (
    last?.role === "assistant" &&
    !last.error &&
    !last.toolCalls?.length &&
    (messageId === undefined || last.messageId === messageId)
  ) {
    return;
  }
  appendMessage(state, {
    role: "assistant",
    content: "",
    ...(messageId !== undefined ? { messageId } : {}),
  });
}

function upsertCommittedAssistantMessage(
  state: SessionState,
  content: string,
  reconcileLiveMessage: boolean,
  messageId?: string,
): void {
  const last = state.messages[state.messages.length - 1];
  if (
    last?.role === "assistant" &&
    !last.error &&
    !last.toolCalls?.length &&
    (messageId !== undefined ? last.messageId === messageId : reconcileLiveMessage)
  ) {
    replaceMessage(state, state.messages.length - 1, {
      ...last,
      content:
        messageId !== undefined
          ? content
          : reconcileCommittedAssistantContent(last.content, content),
    });
    return;
  }
  appendMessage(state, {
    role: "assistant",
    content,
    ...(messageId !== undefined ? { messageId } : {}),
  });
}

function reconcileCommittedAssistantContent(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (incoming.startsWith(existing)) return incoming;
  if (existing.startsWith(incoming)) return existing;
  return incoming;
}

function mergeStreamingText(existing: string, incoming: string): string {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;

  // Some SDKs emit cumulative "text so far" chunks instead of strict
  // incremental deltas. Normalize to avoid duplicating already-rendered text.
  if (incoming.startsWith(existing)) {
    return incoming;
  }

  return existing + incoming;
}

// Unlike mergeStreamingText (which splices deltas of ONE growing message),
// subagent assistant_message events are whole committed messages — joined as
// separate paragraphs.
function appendCommittedSubagentContent(existing: string, incoming: string): string {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;
  return `${existing}\n\n${incoming}`;
}

function appendAssistantDelta(state: SessionState, content: string): void {
  const last = state.messages[state.messages.length - 1];
  if (!last || last.role !== "assistant") return;
  replaceMessage(state, state.messages.length - 1, {
    ...last,
    content: mergeStreamingText(last.content, content),
  });
}

// ============================================================================
// Tool call helpers
// ============================================================================

function toQuestionBase(question: SessionQuestion): SessionQuestionBase {
  return {
    question: question.question,
    ...(question.choices ? { choices: question.choices } : {}),
    allowFreeform: question.allowFreeform,
    ...(question.blocking !== undefined ? { blocking: question.blocking } : {}),
    ...(question.secret !== undefined ? { secret: question.secret } : {}),
  };
}

function markPendingQuestionUnanswered(messages: Message[]): Message[] {
  let result = messages;
  for (const [messageIndex, message] of messages.entries()) {
    if (message.role !== "assistant" || !message.toolCalls) continue;
    let tools = message.toolCalls;
    for (const [index, tool] of tools.entries()) {
      if (tool.question?.state !== "pending") continue;
      tools = replaceAt(tools, index, {
        ...tool,
        question: { ...toQuestionBase(tool.question), state: "unanswered" },
      });
    }
    if (tools !== message.toolCalls)
      result = replaceAt(result, messageIndex, { ...message, toolCalls: tools });
  }
  return result;
}

function upsertToolCallOnLastAssistant(state: SessionState, toolCall: ToolCall): void {
  const last = state.messages[state.messages.length - 1];
  if (!last || last.role !== "assistant") return;
  const toolCalls = last.toolCalls ?? [];
  const index = toolCalls.findIndex((candidate) => candidate.id === toolCall.id);
  replaceMessage(state, state.messages.length - 1, {
    ...last,
    toolCalls: index === -1 ? [...toolCalls, toolCall] : replaceAt(toolCalls, index, toolCall),
  });
}

/** Replace a tool call wherever it lives in the transcript. */
function updateToolCall(
  state: SessionState,
  toolCallId: string,
  update: (toolCall: ToolCall) => ToolCall,
): void {
  for (let messageIndex = state.messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = state.messages[messageIndex];
    if (message.role !== "assistant" || !message.toolCalls) continue;

    const toolCallIndex = message.toolCalls.findIndex((toolCall) => toolCall.id === toolCallId);
    if (toolCallIndex === -1) continue;

    const current = message.toolCalls[toolCallIndex];
    const next = update(current);
    if (next === current) return;

    replaceMessage(state, messageIndex, {
      ...message,
      toolCalls: replaceAt(message.toolCalls, toolCallIndex, next),
    });
    return;
  }
}

function updateSubagentActivity(
  state: SessionState,
  parentToolCallId: string,
  update: (activity: SubagentActivity) => SubagentActivity,
): void {
  updateToolCall(state, parentToolCallId, (toolCall) => {
    const current = toolCall.subagent ?? {};
    const subagent = update(current);
    return subagent === current ? toolCall : { ...toolCall, subagent };
  });
}

function updateSubagentToolCall(
  state: SessionState,
  parentToolCallId: string,
  toolCallId: string,
  update: (toolCall: ToolCall) => ToolCall,
): void {
  updateSubagentActivity(state, parentToolCallId, (activity) => {
    const toolCalls = activity.toolCalls;
    const index = toolCalls?.findIndex((toolCall) => toolCall.id === toolCallId) ?? -1;
    if (!toolCalls || index === -1) return activity;
    return { ...activity, toolCalls: replaceAt(toolCalls, index, update(toolCalls[index])) };
  });
}

function updateQuestion(
  state: SessionState,
  toolCallId: string,
  update: (toolCall: ToolCall) => ToolCall,
): void {
  const hadBlockingQuestion = hasBlockingSessionQuestion(state);
  updateToolCall(state, toolCallId, update);
  const hasBlockingQuestion = hasBlockingSessionQuestion(state);

  if (hasBlockingQuestion !== hadBlockingQuestion) {
    state.status = "thinking";
    if (hasBlockingQuestion) state.reasoningContent = "";
  }
}

// ============================================================================
// Queue helpers
// ============================================================================

function upsertQueuedMessage(
  state: SessionState,
  message: SessionState["queuedMessages"][number],
): void {
  const index = state.queuedMessages.findIndex(
    (candidate) => candidate.clientId === message.clientId,
  );
  state.queuedMessages =
    index === -1
      ? [...state.queuedMessages, message]
      : replaceAt(state.queuedMessages, index, message);
}

function setQueuedMessageStatus(
  state: SessionState,
  clientId: string,
  status: SessionState["queuedMessages"][number]["status"],
): void {
  const index = state.queuedMessages.findIndex((message) => message.clientId === clientId);
  if (index === -1 || state.queuedMessages[index].status === status) return;
  state.queuedMessages = replaceAt(state.queuedMessages, index, {
    ...state.queuedMessages[index],
    status,
  });
}

function removeQueuedMessage(state: SessionState, clientId: string): void {
  if (state.queuedMessages.length === 0) return;

  const index = state.queuedMessages.findIndex((message) => message.clientId === clientId);
  if (index === -1) return;
  state.queuedMessages = [
    ...state.queuedMessages.slice(0, index),
    ...state.queuedMessages.slice(index + 1),
  ];
}

function appendMessage(state: SessionState, message: Message): void {
  state.messages = [...state.messages, message];
}

function replaceMessage(state: SessionState, index: number, message: Message): void {
  state.messages = replaceAt(state.messages, index, message);
}

function replaceAt<T>(items: T[], index: number, item: T): T[] {
  return [...items.slice(0, index), item, ...items.slice(index + 1)];
}

// ============================================================================
// Todo helpers
// ============================================================================

function applyTodoPatches(current: TodoItem[], patches: TodoItemPatch[]): TodoItem[] {
  if (patches.length === 0) return current;

  let next = current.map((todo) => ({ ...todo }));

  for (const patch of patches) {
    if (patch.type === "replace_all") {
      next = patch.items.map((todo) => ({ ...todo }));
      continue;
    }
    if (patch.type === "update_all") {
      for (const todo of next) {
        todo.status = patch.status;
      }
      continue;
    }

    const index = next.findIndex((todo) => todo.id === patch.id);

    if (patch.type === "delete") {
      if (index !== -1) next.splice(index, 1);
      continue;
    }

    if (index === -1) {
      if (patch.title === undefined) continue;
      next.push({
        id: patch.id,
        title: patch.title,
        status: patch.status ?? "pending",
      });
      continue;
    }

    const existing = next[index];
    next[index] = {
      ...existing,
      title: patch.title ?? existing.title,
      status: patch.status ?? existing.status,
    };
  }

  return next;
}
