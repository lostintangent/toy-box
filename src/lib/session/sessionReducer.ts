// Canonical session state reducer. Both streaming and history replay feed
// the same SessionEvents through `applySessionEvent`, so this module is the
// single source of truth for how session state changes and stays agnostic to
// Copilot SDK details.

import type {
  Message,
  QueuedMessage,
  SessionEvent,
  SessionStatus,
  TodoItem,
  TodoItemPatch,
  ToolCall,
} from "@/types";

export type Session = {
  messages: Message[];
  queuedMessages: QueuedMessage[];
  summary?: string;
  todos?: TodoItem[];
  status: SessionStatus;
  reasoningContent: string;
  model?: string;
  pendingToolCalls: Map<string, ToolCall>;
  pendingOptimisticUserMessage?: {
    clientMessageId: string;
    index: number;
  };
  lastSeenEventId?: number;
  activeTurnId?: string;
};

// ============================================================================
// State initialization
// ============================================================================

export function createInitialSession(initial: Partial<Session> = {}): Session {
  return {
    messages: initial.messages ? [...initial.messages] : [],
    queuedMessages: initial.queuedMessages ? [...initial.queuedMessages] : [],
    summary: initial.summary,
    todos: initial.todos ? initial.todos.map((todo) => ({ ...todo })) : undefined,
    status: initial.status ?? "idle",
    reasoningContent: initial.reasoningContent ?? "",
    model: initial.model,
    pendingToolCalls: new Map(),
  };
}

// ============================================================================
// Message helpers
// ============================================================================

function isDuplicateUserMessage(
  state: Session,
  event: { content: string; turnId?: string },
): boolean {
  if (!event.turnId || event.turnId !== state.activeTurnId) return false;
  const prev = state.messages[state.messages.length - 1];
  return prev?.role === "user" && prev.content === event.content;
}

/** Reconcile an incoming user_message with a previously optimistic one.
 *  Returns true if the event was handled (caller should return early). */
function reconcileOptimisticUserMessage(
  state: Session,
  event: Extract<SessionEvent, { type: "user_message" }>,
): boolean {
  const pending = state.pendingOptimisticUserMessage;
  if (!event.clientMessageId || !pending || pending.clientMessageId !== event.clientMessageId) {
    return false;
  }

  const existing = state.messages[pending.index];
  if (existing?.role !== "user") {
    state.pendingOptimisticUserMessage = undefined;
    return false;
  }

  const nextAttachments = event.attachments ?? existing.attachments;
  const nextTimestamp = event.timestamp ?? existing.timestamp;
  if (
    existing.content !== event.content ||
    existing.attachments !== nextAttachments ||
    existing.timestamp !== nextTimestamp
  ) {
    state.messages[pending.index] = {
      ...existing,
      content: event.content,
      attachments: nextAttachments,
      timestamp: nextTimestamp,
    };
  }

  if (event.eventId !== undefined) {
    state.pendingOptimisticUserMessage = undefined;
  }
  return true;
}

function ensureAssistantMessage(state: Session): boolean {
  const last = state.messages[state.messages.length - 1];
  if (last?.role === "assistant") return false;
  state.messages.push({ role: "assistant", content: "" });
  return true;
}

// Like ensureAssistantMessage, but also starts a new message when the current
// one already has tool calls — so that text after tool execution lands on a
// fresh assistant message, preserving the interleaving of text and tool groups.
function ensureCleanAssistantMessage(state: Session): boolean {
  const last = state.messages[state.messages.length - 1];
  if (last?.role === "assistant" && !last.toolCalls?.length && state.pendingToolCalls.size === 0) {
    return false;
  }
  // Finalize: pending tool calls have already been applied to the previous message.
  state.pendingToolCalls.clear();
  state.messages.push({ role: "assistant", content: "" });
  return true;
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

function appendAssistantDelta(state: Session, content: string): void {
  if (!content.length) return;
  const last = state.messages[state.messages.length - 1];
  if (!last || last.role !== "assistant") return;
  last.content = mergeStreamingText(last.content, content);
}

// ============================================================================
// Tool call helpers
// ============================================================================

function applyPendingToolCallsToLastAssistant(state: Session): void {
  const last = state.messages[state.messages.length - 1];
  if (!last || last.role !== "assistant") return;
  const toolCalls = Array.from(state.pendingToolCalls.values());
  last.toolCalls = toolCalls.length > 0 ? toolCalls : undefined;
}

/** Search committed messages (newest first) for a tool call by ID.
 *  When found, bumps the message's revision so React re-renders it. */
function findCommittedToolCall(state: Session, toolCallId: string): ToolCall | undefined {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const msg = state.messages[i];
    if (msg.role !== "assistant" || !msg.toolCalls) continue;
    const tc = msg.toolCalls.find((t) => t.toolCallId === toolCallId);
    if (tc) {
      msg.revision = (msg.revision ?? 0) + 1;
      return tc;
    }
  }
  return undefined;
}

function appendChildToolCall(parent: ToolCall, child: ToolCall): void {
  parent.childToolCalls = parent.childToolCalls ? [...parent.childToolCalls, child] : [child];
}

// ============================================================================
// Queue helpers
// ============================================================================

function removeQueuedMessage(state: Session, queuedMessageId?: string): void {
  if (state.queuedMessages.length === 0) return;

  if (!queuedMessageId) {
    state.queuedMessages.shift();
    return;
  }

  const index = state.queuedMessages.findIndex((message) => message.id === queuedMessageId);
  if (index === -1) return;
  state.queuedMessages.splice(index, 1);
}

function applyTodoPatches(
  current: TodoItem[] | undefined,
  patches: TodoItemPatch[],
): TodoItem[] | undefined {
  if (patches.length === 0) return current;

  const next = current ? current.map((todo) => ({ ...todo })) : [];

  for (const patch of patches) {
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

  return next.length > 0 ? next : undefined;
}

// ============================================================================
// Event reducer
// ============================================================================

function applySessionEventCore(state: Session, event: SessionEvent): void {
  if (event.eventId !== undefined || event.turnId !== undefined) {
    const lastSeenEventId = event.eventId ?? state.lastSeenEventId;
    const activeTurnId = event.turnId ?? state.activeTurnId;
    if (lastSeenEventId !== state.lastSeenEventId || activeTurnId !== state.activeTurnId) {
      state.lastSeenEventId = lastSeenEventId;
      state.activeTurnId = activeTurnId;
    }
  }

  switch (event.type) {
    // ── Messages ──────────────────────────────────────────────────────

    case "user_message": {
      if (reconcileOptimisticUserMessage(state, event)) return;
      if (isDuplicateUserMessage(state, event)) return;

      state.messages.push({
        role: "user",
        content: event.content,
        attachments: event.attachments,
        timestamp: event.timestamp,
      });
      if (event.clientMessageId && event.eventId === undefined) {
        state.pendingOptimisticUserMessage = {
          clientMessageId: event.clientMessageId,
          index: state.messages.length - 1,
        };
      }
      return;
    }

    case "assistant_message": {
      const toolCalls = event.toolCalls?.length ? event.toolCalls : undefined;
      state.messages.push({
        role: "assistant",
        content: event.content,
        toolCalls,
      });
      return;
    }

    case "message_queued": {
      if (state.queuedMessages.some((m) => m.id === event.queuedMessageId)) return;
      state.queuedMessages.push({
        id: event.queuedMessageId,
        role: "user",
        content: event.content,
        attachments: event.attachments,
      });
      return;
    }

    case "message_cancelled": {
      removeQueuedMessage(state, event.queuedMessageId);
      return;
    }

    case "message_dequeued": {
      removeQueuedMessage(state, event.queuedMessageId);
      // Dedup: same as user_message — buffer replay after reconnect.
      if (isDuplicateUserMessage(state, event)) return;
      state.messages.push({ role: "user", content: event.content });
      return;
    }

    // ── Streaming content ─────────────────────────────────────────────

    case "thinking": {
      const insertedAssistant = ensureCleanAssistantMessage(state);
      if (!insertedAssistant && state.status === "thinking" && state.reasoningContent === "") {
        return;
      }
      state.status = "thinking";
      state.reasoningContent = "";
      return;
    }

    case "delta": {
      // Ignore empty deltas. They carry no content and would otherwise
      // call ensureCleanAssistantMessage, which clears pendingToolCalls
      // and creates a new message — fragmenting the conversation and
      // potentially dropping in-flight tool call results.
      if (event.content.length === 0) return;

      ensureCleanAssistantMessage(state);
      state.status = "responding";
      state.reasoningContent = "";
      appendAssistantDelta(state, event.content);
      return;
    }

    case "reasoning":
      state.status = "reasoning";
      state.reasoningContent = mergeStreamingText(state.reasoningContent, event.content);
      return;

    // ── Tool calls ────────────────────────────────────────────────────

    case "tool_start": {
      ensureAssistantMessage(state);

      if (event.parentToolCallId) {
        const child: ToolCall = {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          arguments: event.arguments,
        };
        // Nest under parent tool call (check pending first, then committed messages)
        const parent = state.pendingToolCalls.get(event.parentToolCallId);
        if (parent) {
          appendChildToolCall(parent, child);
          state.pendingToolCalls.set(event.parentToolCallId, { ...parent });
        } else {
          const parentTc = findCommittedToolCall(state, event.parentToolCallId);
          if (parentTc) appendChildToolCall(parentTc, child);
        }
      } else {
        state.pendingToolCalls.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          arguments: event.arguments,
        });
      }

      applyPendingToolCallsToLastAssistant(state);
      return;
    }

    case "tool_end": {
      const result = { content: event.result ?? "", success: event.success };

      if (event.parentToolCallId) {
        // Complete a child tool call nested under parent (check pending first, then committed)
        const parent = state.pendingToolCalls.get(event.parentToolCallId);
        const childList =
          parent?.childToolCalls ??
          findCommittedToolCall(state, event.parentToolCallId)?.childToolCalls;
        if (childList) {
          const childIndex = childList.findIndex((c) => c.toolCallId === event.toolCallId);
          if (childIndex !== -1) {
            childList[childIndex] = { ...childList[childIndex], result };
            if (parent) {
              state.pendingToolCalls.set(event.parentToolCallId, { ...parent });
            }
          }
        }
      } else {
        const current = state.pendingToolCalls.get(event.toolCallId);
        if (current) {
          state.pendingToolCalls.set(event.toolCallId, { ...current, result });
        }
      }
      applyPendingToolCallsToLastAssistant(state);
      return;
    }

    // ── Status & metadata ─────────────────────────────────────────────

    case "compacting_start":
      if (state.status === "compacting") return;
      state.status = "compacting";
      return;

    case "compacting_end":
      if (state.status !== "compacting") return;
      state.status = "thinking";
      return;

    case "session_title_changed":
      if (state.summary === event.title) return;
      state.summary = event.title;
      return;

    case "todos_patch": {
      state.todos = applyTodoPatches(state.todos, event.patches);
      return;
    }

    // ── Model ─────────────────────────────────────────────────────────

    case "model_changed":
      state.model = event.model;
      return;

    // ── Lifecycle ─────────────────────────────────────────────────────

    case "stream_end":
      if (
        state.status === "idle" &&
        state.reasoningContent === "" &&
        state.pendingToolCalls.size === 0
      ) {
        return;
      }
      state.status = "idle";
      state.reasoningContent = "";
      state.pendingToolCalls.clear();
      state.pendingOptimisticUserMessage = undefined;
      return;

    default:
      return;
  }
}

export function applySessionEvent(state: Session, event: SessionEvent): Session {
  applySessionEventCore(state, event);
  return state;
}
