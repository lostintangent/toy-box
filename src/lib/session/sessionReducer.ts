// Canonical session state reducer — the single transition function for
// Session state. Three consumers feed it the same SessionEvents:
//   - server live streaming (SessionStream#emit, runtime/stream/sessionStream.ts)
//   - server history replay (sdk/historyReplay.ts)
//   - the client, for live SSE events and the buffered-event replay a
//     late-connecting client catches up on (useSession#applyEvent)
// Sharing this module is what guarantees a transcript renders identically
// whether it is watched live, reloaded, or reconnected to. It stays agnostic
// to Copilot SDK details — SDK translation policy lives in
// functions/sdk/projector.ts.
//
// Vocabulary used throughout this file:
//   - root vs agent-scoped: events without an agentId mutate the top-level
//     transcript; events carrying one mutate the subagent state nested under
//     the spawning agent tool call (toolCall.agent).
//   - pending vs committed: the in-progress message group's tool calls live
//     in pendingToolCalls, mirrored onto the last assistant message after
//     every change. A boundary "commits" them — afterwards they are only
//     reachable by searching committed messages.
//   - message group / boundary: an assistant turn renders as alternating
//     text and tool-call groups. A boundary — the first text delta after
//     tool calls (live), or a committed root assistant_message (replay) —
//     finalizes the current group and starts a fresh assistant message.
//
// Identity contract: each event returns a new Session with structural sharing.
// Every changed render-visible branch gets a new identity, while unchanged
// messages and nested tool calls retain theirs. pendingToolCalls is internal
// bookkeeping, also replaced only when it changes. This lets clients batch
// when they publish state to React without obscuring what changed.

import { notificationCoalesceKey } from "@/lib/session/agentNotifications";
import type {
  Message,
  ModelConfiguration,
  QueuedMessage,
  SessionArtifactPatch,
  SessionCanvas,
  SessionEvent,
  SessionSnapshot,
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
  linkedSessionIds: string[];
  canvases?: SessionCanvas[];
  artifacts: string[];
  status: SessionStatus;
  reasoningContent: string;
  model?: ModelConfiguration;
  pendingToolCalls: Map<string, ToolCall>;
  pendingOptimisticUserMessage?: {
    clientMessageId: string;
    index: number;
  };
  lastSeenEventId?: number;
  activeTurnId?: string;
};

// ============================================================================
// Public API
// ============================================================================

export function createInitialSession(initial: Partial<Session> = {}): Session {
  return {
    messages: initial.messages ? [...initial.messages] : [],
    queuedMessages: initial.queuedMessages ? [...initial.queuedMessages] : [],
    summary: initial.summary,
    todos: initial.todos ? initial.todos.map((todo) => ({ ...todo })) : undefined,
    linkedSessionIds: initial.linkedSessionIds ? [...initial.linkedSessionIds] : [],
    ...(initial.canvases ? { canvases: initial.canvases.map((canvas) => ({ ...canvas })) } : {}),
    artifacts: initial.artifacts ? [...initial.artifacts] : [],
    status: initial.status ?? "idle",
    reasoningContent: initial.reasoningContent ?? "",
    model: initial.model,
    pendingToolCalls: new Map(),
  };
}

/** Project a Session into the wire/query snapshot shape — the one mapping
 *  shared by the server (querySession) and the client (detail query cache).
 *  `previous` lets the client preserve fields the live state hasn't learned
 *  yet; the server omits it. */
export function toSessionSnapshot(
  sessionId: string,
  state: Session,
  previous?: SessionSnapshot,
): SessionSnapshot {
  return {
    id: previous?.id ?? sessionId,
    messages: state.messages,
    queuedMessages: state.queuedMessages,
    model: state.model ?? previous?.model,
    todos: state.todos,
    linkedSessionIds: state.linkedSessionIds.length > 0 ? state.linkedSessionIds : undefined,
    canvases: state.canvases && state.canvases.length > 0 ? state.canvases : undefined,
    artifacts: state.artifacts.length > 0 ? state.artifacts : undefined,
    lastSeenEventId: state.lastSeenEventId,
    status: state.status,
    reasoningContent: state.reasoningContent,
  };
}

/** Rebuild reducer seed state from a wire snapshot — the inverse of
 *  toSessionSnapshot, for seeding a stream from a cached snapshot without
 *  replaying history.
 *  Drops the wire/per-stream fields (`id`, `lastSeenEventId`) so a fresh
 *  stream stamps its own event sequence. createInitialSession copies the
 *  collections; individual messages share structure with the snapshot, the
 *  same convention the client uses when seeding its reducer from the cached
 *  detail snapshot. */
export function sessionSeedFromSnapshot(snapshot: SessionSnapshot): Partial<Session> {
  const { id: _id, lastSeenEventId: _lastSeenEventId, ...seed } = snapshot;
  return seed;
}

/** Reduce one canonical event into a new Session. The switch mutates only this
 *  fresh shallow root; helpers replace every nested branch they change. */
export function applySessionEvent(state: Session, event: SessionEvent): Session {
  const next = { ...state };
  applySessionEventCore(next, event);
  return next;
}

/** Reset turn-scoped state ahead of a new turn, preserving durable session
 *  state. The turn-boundary sibling of the end handler below — the
 *  same transient fields, but transitioning into "thinking" instead of idle. */
export function prepareSessionForNextTurn(state: Session): Session {
  return {
    ...state,
    status: "thinking",
    reasoningContent: "",
    pendingToolCalls: new Map(),
    pendingOptimisticUserMessage: undefined,
  };
}

// ============================================================================
// Event reducer
// ============================================================================

function applySessionEventCore(state: Session, event: SessionEvent): void {
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
  if (event.turnId !== undefined) state.activeTurnId = event.turnId;

  switch (event.type) {
    // ── Messages ──────────────────────────────────────────────────────

    case "user_message": {
      if (event.clientMessageId) removeQueuedMessage(state, event.clientMessageId);
      if (event.isSteered) removeMatchingSteeringMessage(state, event);
      if (reconcileOptimisticUserMessage(state, event)) return;
      if (isRedundantTurnStartEcho(state, event)) return;

      appendMessage(state, {
        role: "user",
        content: event.content,
        attachments: event.attachments,
        timestamp: event.timestamp,
      });
      // Only locally-synthesized events lack an eventId (the server stamps
      // one on everything it emits). Remember the optimistic message so the
      // server's decorated echo reconciles it instead of duplicating it.
      if (event.clientMessageId && event.eventId === undefined) {
        state.pendingOptimisticUserMessage = {
          clientMessageId: event.clientMessageId,
          index: state.messages.length - 1,
        };
      }
      return;
    }

    case "agent_notification": {
      if (isRedundantTurnStartEcho(state, event)) return;

      appendMessage(state, {
        role: "agent_notification",
        notification: event.notification,
        timestamp: event.timestamp,
      });
      return;
    }

    case "assistant_message": {
      if (event.agentId) {
        updateToolCall(state, event.agentId, (toolCall) => ({
          ...toolCall,
          agent: {
            ...toolCall.agent,
            content: appendCommittedAgentContent(toolCall.agent?.content ?? "", event.content),
          },
        }));
        return;
      }

      // Turn boundary: a committed root assistant message finalizes the
      // previous message group's pending tool calls. In live streams it may
      // arrive after thinking/deltas, so reconcile it with the in-flight
      // assistant placeholder instead of appending duplicate text.
      const reconcileLiveMessage =
        state.status === "thinking" ||
        state.status === "reasoning" ||
        state.status === "responding";
      state.pendingToolCalls = new Map();

      upsertCommittedAssistantMessage(state, event.content, reconcileLiveMessage);
      if (reconcileLiveMessage && event.content) {
        state.status = "responding";
        state.reasoningContent = "";
      }
      return;
    }

    case "message_queued": {
      upsertQueuedMessage(state, event.message);
      return;
    }

    case "message_cancelled":
    case "message_dequeued": {
      removeQueuedMessage(state, event.queuedMessageId);
      return;
    }

    // ── Streaming content ─────────────────────────────────────────────

    case "status": {
      state.status = event.status;
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

    case "reasoning": {
      if (event.agentId) {
        updateToolCall(state, event.agentId, (toolCall) => ({
          ...toolCall,
          agent: {
            ...toolCall.agent,
            reasoningContent: mergeStreamingText(
              toolCall.agent?.reasoningContent ?? "",
              event.content,
            ),
          },
        }));
        return;
      }

      state.status = "reasoning";
      state.reasoningContent = mergeStreamingText(state.reasoningContent, event.content);
      return;
    }

    // ── Tool calls ────────────────────────────────────────────────────

    case "tool_start": {
      ensureAssistantMessage(state);

      if (event.agentId) {
        // Nest subagent tool calls under their agent call.
        const child: ToolCall = {
          id: event.toolCallId,
          name: event.toolName,
          arguments: event.arguments,
        };
        updateToolCall(state, event.agentId, (parent) => ({
          ...parent,
          agent: {
            ...parent.agent,
            toolCalls: parent.agent?.toolCalls ? [...parent.agent.toolCalls, child] : [child],
          },
        }));
        return;
      }

      state.pendingToolCalls = new Map(state.pendingToolCalls).set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        arguments: event.arguments,
      });
      applyPendingToolCallsToLastAssistant(state);
      return;
    }

    case "tool_end": {
      const result = {
        content: event.result ?? "",
        success: event.success,
        details: event.details,
      };

      if (event.agentId) {
        // Complete a child tool call nested under its agent call.
        updateToolCall(state, event.agentId, (parent) => {
          const childToolCalls = parent.agent?.toolCalls;
          const index = childToolCalls?.findIndex((child) => child.id === event.toolCallId) ?? -1;
          if (!childToolCalls || index === -1) return parent;

          return {
            ...parent,
            agent: {
              ...parent.agent,
              toolCalls: replaceAt(childToolCalls, index, {
                ...childToolCalls[index],
                result,
              }),
            },
          };
        });
        return;
      }

      // Deferred completions can arrive after a message boundary has moved the
      // call out of pendingToolCalls. The shared updater resolves either form.
      updateToolCall(state, event.toolCallId, (toolCall) => ({ ...toolCall, result }));
      return;
    }

    // ── Status & metadata ─────────────────────────────────────────────

    case "session_title_changed":
      if (state.summary === event.title) return;
      state.summary = event.title;
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

    case "artifacts_patch": {
      applyArtifactPatches(state, event.patches);
      return;
    }

    // ── Model ─────────────────────────────────────────────────────────

    case "model_changed":
      if (event.agentId) {
        updateToolCall(state, event.agentId, (toolCall) => ({
          ...toolCall,
          agent: {
            ...toolCall.agent,
            model: event.model,
          },
        }));
        return;
      }

      state.model = event.model;
      return;

    // ── Lifecycle ─────────────────────────────────────────────────────

    case "end":
      // Idempotent on purpose: clients can synthesize fallback end events for
      // event-less completions/transport failures, and replays can deliver one
      // after state is already final.
      if (event.reason === "error") {
        finishWithError(state);
        return;
      }

      if (
        state.status === "idle" &&
        state.reasoningContent === "" &&
        state.pendingToolCalls.size === 0 &&
        state.pendingOptimisticUserMessage === undefined
      ) {
        return;
      }
      state.status = "idle";
      state.reasoningContent = "";
      state.pendingToolCalls = new Map();
      state.pendingOptimisticUserMessage = undefined;
      return;

    default:
      event satisfies never;
      return;
  }
}

function finishWithError(state: Session): void {
  const message = state.messages[state.messages.length - 1];
  const errorContent = "An error occurred. Please try again.";
  if (message?.role === "assistant") {
    replaceMessage(state, state.messages.length - 1, {
      ...message,
      content: errorContent,
    });
  } else {
    appendMessage(state, {
      role: "assistant",
      content: errorContent,
    });
  }

  state.status = "idle";
  state.reasoningContent = "";
  state.pendingToolCalls = new Map();
  state.pendingOptimisticUserMessage = undefined;
}

// ============================================================================
// Canvas and artifact helpers
// ============================================================================

function createCanvasKey(
  canvas: Pick<SessionCanvas, "extensionId" | "canvasId" | "instanceId">,
): string {
  return JSON.stringify([canvas.extensionId ?? null, canvas.canvasId, canvas.instanceId]);
}

function upsertCanvas(state: Session, canvas: Omit<SessionCanvas, "key" | "revision">): void {
  const key = createCanvasKey(canvas);
  const currentCanvases = state.canvases ?? [];
  const index = currentCanvases.findIndex((candidate) => candidate.key === key);

  if (index === -1) {
    state.canvases = [...currentCanvases, { ...canvas, key, revision: 1 }];
    return;
  }

  const current = currentCanvases[index];
  const next = [...currentCanvases];
  next[index] = {
    ...canvas,
    key,
    revision: current.revision + 1,
  };
  state.canvases = next;
}

function upsertArtifact(state: Session, path: string): void {
  if (state.artifacts.includes(path)) return;
  state.artifacts = [...state.artifacts, path];
}

function removeArtifact(state: Session, path: string): void {
  const artifacts = state.artifacts.filter((artifact) => artifact !== path);
  if (artifacts.length === state.artifacts.length) return;
  state.artifacts = artifacts;
}

function applyArtifactPatches(state: Session, patches: SessionArtifactPatch[]): void {
  for (const patch of patches) {
    if (patch.type === "delete") {
      removeArtifact(state, patch.path);
      continue;
    }

    upsertArtifact(state, patch.path);
  }
}

// ============================================================================
// Message helpers
// ============================================================================

function isRedundantTurnStartEcho(
  state: Session,
  event: Extract<SessionEvent, { type: "user_message" | "agent_notification" }>,
): boolean {
  // A steered user message is a new user action even when its content and turn
  // segment match the opening message.
  if (
    (event.type === "user_message" && event.isSteered) ||
    !event.turnId ||
    event.turnId !== state.activeTurnId
  ) {
    return false;
  }

  // This is not optimistic reconciliation. The runtime already emitted the
  // canonical event that starts this turn; this only drops the later SDK echo
  // when it matches that opening message.
  for (let index = state.messages.length - 1; index >= 0; index--) {
    const message = state.messages[index];
    if (message.role === "assistant" && (message.content || message.toolCalls?.length))
      return false;
    if (message.role !== "assistant") return matchesInputEvent(message, event);
  }
  return false;
}

function matchesInputEvent(
  message: Extract<Message, { role: "user" | "agent_notification" }>,
  event: Extract<SessionEvent, { type: "user_message" | "agent_notification" }>,
): boolean {
  return message.role === "user"
    ? event.type === "user_message" && message.content === event.content
    : event.type === "agent_notification" &&
        notificationCoalesceKey(message.notification) ===
          notificationCoalesceKey(event.notification);
}

/** Reconcile an incoming user_message with a previously optimistic one.
 *  Returns true if the event was handled (caller should return early). */
function reconcileOptimisticUserMessage(
  state: Session,
  event: Extract<SessionEvent, { type: "user_message" }>,
): boolean {
  const pending = state.pendingOptimisticUserMessage;
  if (!pending) return false;

  const existing = state.messages[pending.index];
  if (existing?.role !== "user") {
    state.pendingOptimisticUserMessage = undefined;
    return false;
  }

  if (event.clientMessageId !== pending.clientMessageId) return false;

  const nextAttachments = event.attachments ?? existing.attachments;
  const nextTimestamp = event.timestamp ?? existing.timestamp;
  if (
    existing.content !== event.content ||
    existing.attachments !== nextAttachments ||
    existing.timestamp !== nextTimestamp
  ) {
    replaceMessage(state, pending.index, {
      role: "user",
      content: event.content,
      attachments: nextAttachments,
      timestamp: nextTimestamp,
    });
  }

  if (event.eventId !== undefined) {
    state.pendingOptimisticUserMessage = undefined;
  }
  return true;
}

function ensureAssistantMessage(state: Session): void {
  const last = state.messages[state.messages.length - 1];
  if (last?.role === "assistant") return;
  appendMessage(state, { role: "assistant", content: "" });
}

// Like ensureAssistantMessage, but also starts a new message when the current
// one already has tool calls — so that text after tool execution lands on a
// fresh assistant message, preserving the interleaving of text and tool groups.
function ensureCleanAssistantMessage(state: Session): void {
  const last = state.messages[state.messages.length - 1];
  if (last?.role === "assistant" && !last.toolCalls?.length && state.pendingToolCalls.size === 0) {
    return;
  }
  // Finalize: pending tool calls have already been applied to the previous message.
  state.pendingToolCalls = new Map();
  appendMessage(state, { role: "assistant", content: "" });
}

function upsertCommittedAssistantMessage(
  state: Session,
  content: string,
  reconcileLiveMessage: boolean,
): void {
  const last = state.messages[state.messages.length - 1];
  if (reconcileLiveMessage && last?.role === "assistant" && !last.toolCalls?.length) {
    replaceMessage(state, state.messages.length - 1, {
      ...last,
      content: reconcileCommittedAssistantContent(last.content, content),
    });
    return;
  }
  appendMessage(state, { role: "assistant", content });
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
// agent assistant_message events are whole committed messages — joined as
// separate paragraphs.
function appendCommittedAgentContent(existing: string, incoming: string): string {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;
  return `${existing}\n\n${incoming}`;
}

function appendAssistantDelta(state: Session, content: string): void {
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

function applyPendingToolCallsToLastAssistant(state: Session): void {
  const last = state.messages[state.messages.length - 1];
  if (!last || last.role !== "assistant") return;
  const toolCalls = Array.from(state.pendingToolCalls.values());
  replaceMessage(state, state.messages.length - 1, {
    ...last,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  });
}

/** Replace a tool call wherever it currently lives. Active calls are mirrored
 *  from pendingToolCalls onto the last message; committed calls can belong to
 *  any earlier message, so replace that exact message branch. */
function updateToolCall(
  state: Session,
  toolCallId: string,
  update: (toolCall: ToolCall) => ToolCall,
): void {
  const pending = state.pendingToolCalls.get(toolCallId);
  if (pending) {
    const next = update(pending);
    if (next === pending) return;
    state.pendingToolCalls = new Map(state.pendingToolCalls).set(toolCallId, next);
    applyPendingToolCallsToLastAssistant(state);
    return;
  }

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

// ============================================================================
// Queue helpers
// ============================================================================

function upsertQueuedMessage(state: Session, message: QueuedMessage): void {
  const index = state.queuedMessages.findIndex((candidate) => candidate.id === message.id);
  state.queuedMessages =
    index === -1
      ? [...state.queuedMessages, message]
      : replaceAt(state.queuedMessages, index, message);
}

function removeMatchingSteeringMessage(
  state: Session,
  event: Extract<SessionEvent, { type: "user_message" }>,
): void {
  const message = state.queuedMessages.find(
    (candidate) =>
      candidate.role === "user" && candidate.isSteering && matchesInputEvent(candidate, event),
  );
  if (message) removeQueuedMessage(state, message.id);
}

function removeQueuedMessage(state: Session, queuedMessageId: string): void {
  if (state.queuedMessages.length === 0) return;

  const index = state.queuedMessages.findIndex((message) => message.id === queuedMessageId);
  if (index === -1) return;
  state.queuedMessages = [
    ...state.queuedMessages.slice(0, index),
    ...state.queuedMessages.slice(index + 1),
  ];
}

function appendMessage(state: Session, message: Message): void {
  state.messages = [...state.messages, message];
}

function replaceMessage(state: Session, index: number, message: Message): void {
  state.messages = replaceAt(state.messages, index, message);
}

function replaceAt<T>(items: T[], index: number, item: T): T[] {
  return [...items.slice(0, index), item, ...items.slice(index + 1)];
}

// ============================================================================
// Todo helpers
// ============================================================================

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
