// Canonical session state reducer — the single transition function for
// Session state. Three consumers feed it the same SessionEvents:
//   - server live streaming (SessionStream#emit, runtime/stream.ts)
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
//     reachable by searching messages (findCommittedToolCall).
//   - message group / boundary: an assistant turn renders as alternating
//     text and tool-call groups. A boundary — the first text delta after
//     tool calls (live), or a committed root assistant_message (replay) —
//     finalizes the current group and starts a fresh assistant message.
//
// Mutation & identity contract: state is mutated IN PLACE. Callers re-read it
// on a revision counter (see useSession) rather than relying on root object
// identity. Identity still matters in the three places memoized React
// subtrees compare:
//   - message.revision is bumped when a committed message changes in place
//     (findCommittedToolCall), so memoized message components re-render
//   - updated tool calls are cloned back into pendingToolCalls so they get a
//     fresh object identity when applied to the message
//   - linkedSessionIds is replaced rather than mutated because consumers use
//     it in hook dependency arrays

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
  modelConfiguration?: ModelConfiguration;
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
    modelConfiguration: initial.modelConfiguration,
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
    modelConfiguration: state.modelConfiguration ?? previous?.modelConfiguration,
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

/** Mutates `state` in place and returns it (for chaining convenience).
 *  The switch lives in applySessionEventCore so handlers can use bare returns. */
export function applySessionEvent(state: Session, event: SessionEvent): Session {
  applySessionEventCore(state, event);
  return state;
}

/** Reset turn-scoped state ahead of a new turn, preserving durable session
 *  state. The turn-boundary sibling of the end handler below — the
 *  same transient fields, but transitioning into "thinking" instead of idle. */
export function prepareSessionForNextTurn(state: Session): Session {
  state.status = "thinking";
  state.reasoningContent = "";
  state.pendingToolCalls.clear();
  state.pendingOptimisticUserMessage = undefined;
  return state;
}

/** Client-side recovery for a failed stream: surface `content` as the
 *  trailing assistant message (replacing a partial one, or appending) and
 *  reset transient streaming state. */
export function applyStreamError(state: Session, content: string): Session {
  const last = state.messages[state.messages.length - 1];
  if (last?.role === "assistant") {
    state.messages[state.messages.length - 1] = { ...last, content };
  } else {
    state.messages.push({ role: "assistant", content });
  }

  state.status = "idle";
  state.reasoningContent = "";
  state.pendingToolCalls.clear();
  return state;
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
      if (reconcileOptimisticUserMessage(state, event)) return;
      if (isRedundantTurnStartEcho(state, event)) return;

      state.messages.push({
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

      state.messages.push({
        role: "agent_notification",
        notification: event.notification,
        timestamp: event.timestamp,
      });
      return;
    }

    case "assistant_message": {
      if (event.agentId) {
        updateAgentToolCall(state, event.agentId, (toolCall) => {
          toolCall.agent = {
            ...toolCall.agent,
            content: appendCommittedAgentContent(toolCall.agent?.content ?? "", event.content),
          };
        });
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
      state.pendingToolCalls.clear();

      upsertCommittedAssistantMessage(state, event.content, reconcileLiveMessage);
      if (reconcileLiveMessage && event.content) {
        state.status = "responding";
        state.reasoningContent = "";
      }
      return;
    }

    case "message_queued": {
      if (state.queuedMessages.some((m) => m.id === event.message.id)) return;
      state.queuedMessages.push(event.message);
      return;
    }

    case "message_cancelled": {
      removeQueuedMessage(state, event.queuedMessageId);
      return;
    }

    case "message_dequeued": {
      removeQueuedMessage(state, event.message.id);
      appendQueuedMessageToTranscript(state, event.message);
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
        updateAgentToolCall(state, event.agentId, (toolCall) => {
          toolCall.agent = {
            ...toolCall.agent,
            reasoningContent: mergeStreamingText(
              toolCall.agent?.reasoningContent ?? "",
              event.content,
            ),
          };
        });
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
        updateAgentToolCall(state, event.agentId, (p) => {
          p.agent = {
            ...p.agent,
            toolCalls: p.agent?.toolCalls ? [...p.agent.toolCalls, child] : [child],
          };
        });
        return;
      }

      state.pendingToolCalls.set(event.toolCallId, {
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
        updateAgentToolCall(state, event.agentId, (p) => {
          const index = p.agent?.toolCalls?.findIndex((c) => c.id === event.toolCallId) ?? -1;
          if (index !== -1) {
            p.agent!.toolCalls![index] = { ...p.agent!.toolCalls![index], result };
          }
        });
        return;
      }

      const current = state.pendingToolCalls.get(event.toolCallId);
      if (current) {
        state.pendingToolCalls.set(event.toolCallId, { ...current, result });
        applyPendingToolCallsToLastAssistant(state);
        return;
      }

      // Late completion: deferred completions (e.g. a background agent's
      // subagent.completed → tool_end) arrive after a message boundary has
      // already committed the tool call and cleared it from pending. Resolve
      // against committed messages — the same pending-then-committed fallback
      // the agentId branch above gets via updateAgentToolCall.
      const committed = findCommittedToolCall(state, event.toolCallId);
      if (committed) {
        committed.result = result;
      }
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
        updateAgentToolCall(state, event.agentId, (toolCall) => {
          toolCall.agent = {
            ...toolCall.agent,
            modelConfiguration: event.modelConfiguration,
          };
        });
        return;
      }

      state.modelConfiguration = event.modelConfiguration;
      return;

    // ── Lifecycle ─────────────────────────────────────────────────────

    case "end":
      // Idempotent on purpose: clients synthesize an end event on every
      // stream close, and replays can deliver one after state is already
      // final.
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
      state.pendingToolCalls.clear();
      state.pendingOptimisticUserMessage = undefined;
      return;

    default:
      // Event types with no Session state effect (skills) are consumed by
      // runtimes directly — useSession primes the skills query cache.
      return;
  }
}

// ============================================================================
// Canvas helpers
// ============================================================================

function createCanvasKey(
  canvas: Pick<SessionCanvas, "extensionId" | "canvasId" | "instanceId">,
): string {
  return JSON.stringify([canvas.extensionId ?? null, canvas.canvasId, canvas.instanceId]);
}

function upsertCanvas(state: Session, canvas: Omit<SessionCanvas, "key" | "revision">): void {
  const key = createCanvasKey(canvas);
  const currentCanvases = state.canvases ?? [];
  const index = findCanvasUpsertIndex(currentCanvases, canvas, key);

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

function findCanvasUpsertIndex(
  currentCanvases: SessionCanvas[],
  canvas: Omit<SessionCanvas, "key" | "revision">,
  key: string,
): number {
  const exactIndex = currentCanvases.findIndex((candidate) => candidate.key === key);
  if (exactIndex !== -1 || !canvas.reopen) return exactIndex;

  const matchingIndexes = currentCanvases.reduce<number[]>((indexes, candidate, index) => {
    if (
      (candidate.extensionId ?? null) === (canvas.extensionId ?? null) &&
      candidate.canvasId === canvas.canvasId
    ) {
      indexes.push(index);
    }
    return indexes;
  }, []);

  return matchingIndexes.length === 1 ? matchingIndexes[0] : -1;
}

// ============================================================================
// Message helpers
// ============================================================================

function isRedundantTurnStartEcho(state: Session, event: { turnId?: string }): boolean {
  if (!event.turnId || event.turnId !== state.activeTurnId) return false;

  // This is not optimistic reconciliation. The runtime already emitted the
  // canonical event that starts this turn; this only drops a later SDK
  // transport echo of that same user prompt or agent notification while the
  // turn is still in its opening segment.
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i];
    if (message.role === "user" || message.role === "agent_notification") return true;
    if (message.role === "assistant" && (message.content || message.toolCalls?.length)) {
      return false;
    }
  }
  return false;
}

function appendQueuedMessageToTranscript(state: Session, message: QueuedMessage): void {
  if (message.role === "agent_notification") {
    state.messages.push({
      role: "agent_notification",
      notification: message.notification,
    });
    return;
  }

  state.messages.push({
    role: "user",
    content: message.content,
    attachments: message.attachments,
  });
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
    state.messages[pending.index] = {
      role: "user",
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

function ensureAssistantMessage(state: Session): void {
  const last = state.messages[state.messages.length - 1];
  if (last?.role === "assistant") return;
  state.messages.push({ role: "assistant", content: "" });
}

// Like ensureAssistantMessage, but also starts a new message when the current
// one already has tool calls — so that text after tool execution lands on a
// fresh assistant message, preserving the interleaving of text and tool groups.
// Returns true when a new message was inserted.
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

function upsertCommittedAssistantMessage(
  state: Session,
  content: string,
  reconcileLiveMessage: boolean,
): void {
  const last = state.messages[state.messages.length - 1];
  if (reconcileLiveMessage && last?.role === "assistant" && !last.toolCalls?.length) {
    last.content = reconcileCommittedAssistantContent(last.content, content);
    return;
  }
  state.messages.push({ role: "assistant", content });
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
    const tc = msg.toolCalls.find((t) => t.id === toolCallId);
    if (tc) {
      msg.revision = (msg.revision ?? 0) + 1;
      return tc;
    }
  }
  return undefined;
}

/** Apply a mutation to a parent tool call, resolving it from pendingToolCalls
 *  first and falling back to committed messages. Pending parents are cloned
 *  back into the map and re-applied to the last assistant message so
 *  memoized renderers see a fresh identity; committed parents get their
 *  message's revision bumped via findCommittedToolCall instead — re-applying
 *  a (possibly empty) pending map to a committed parent's message would wipe
 *  its committed tool calls. */
function updateAgentToolCall(
  state: Session,
  agentId: string,
  mutate: (agentToolCall: ToolCall) => void,
): void {
  const pending = state.pendingToolCalls.get(agentId);
  if (pending) {
    mutate(pending);
    state.pendingToolCalls.set(agentId, { ...pending });
    applyPendingToolCallsToLastAssistant(state);
    return;
  }

  const committed = findCommittedToolCall(state, agentId);
  if (committed) {
    mutate(committed);
  }
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
