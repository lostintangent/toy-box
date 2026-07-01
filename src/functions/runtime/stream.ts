// Session streaming runtime — bridges the Copilot SDK's event-driven session
// model to the HTTP streaming interface consumed by the client. Ownership
// boundaries: the projector owns SDK-event translation, the reducer owns
// Session state transitions; this module owns STREAM LIFETIME — the per-
// session registry, the reconnect buffer, event sequencing, turn boundaries,
// and the queued-message drain loop that sends follow-up prompts between
// turns.
//
// Event sequencing contract: every emitted event is stamped with a globally
// monotonic eventId (Date.now-seeded so ids keep increasing across server
// restarts) and the current turnId. Both are load-bearing downstream: the
// reducer's stale-event filter (lastSeenEventId) and duplicate-user-message
// detection (turnId) rely on them, as does the client's `afterEventId`
// reconnect cursor.
//
// The SessionStream class encapsulates all per-stream state: the event buffer,
// queued messages, subscribers, SDK listener, and reducer state. External
// callers use the static registry (get / getOrCreate / close) and instance
// methods — never reaching into internal fields directly.

import type { CopilotSession, SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";
import {
  createSession,
  evictCachedSessionIfStale,
  getCachedOrResumeSession,
  getOrResumeSession,
} from "../state/sessionCache";
import { markSessionUnread, markSessionRead } from "../state/unread";
import { notificationCoalesceKey } from "@/lib/session/agentNotifications";
import { encodeSdkAgentNotification } from "@/functions/sdk/agentNotificationCodec";
import { emitSessionRunning, emitSessionIdle, updateSessionSummary } from "./broadcast";
import {
  applySessionEvent,
  createInitialSession,
  prepareSessionForNextTurn,
  sessionSeedFromSnapshot,
  toSessionSnapshot,
} from "@/lib/session/sessionReducer";
import { cacheSnapshot, getCachedSnapshot } from "../state/snapshotCache";
import {
  createProjectionState,
  getSdkMetadataPatch,
  getSdkStreamTerminalDisposition,
  projectSdkEvent,
} from "@/functions/sdk/projector";
import { initializeSessionStateFromSdkHistory } from "@/functions/sdk/historyReplay";
import { toSdkAttachmentBlobs } from "@/functions/sdk/attachments";
import type { Attachment, ModelConfiguration, QueuedMessage, SessionEvent } from "@/types";
import type { Session } from "@/lib/session/sessionReducer";
import { areModelConfigurationsEqual, toSdkSetModelOptions } from "@/lib/modelConfiguration";
import { sharedMap } from "./processState";

// ============================================================================
// Types
// ============================================================================

export type SessionStreamConfig = {
  sessionId: string;
  prompt?: string;
  attachments?: Attachment[];
  modelConfiguration?: ModelConfiguration;
  directory?: string;
  useWorktree?: boolean;

  clientMessageId?: string;
  afterEventId?: number;
  startNew?: boolean;
};

export type SendOrQueueSessionMessageOptions = Omit<
  SessionStreamConfig,
  "prompt" | "afterEventId" | "attachments" | "modelConfiguration"
> & {
  message: QueuedMessage;
};

type SessionStreamSubscriber = (event: SessionEvent | null) => void;

// Reconnect buffer cap. A client reconnecting across a gap larger than this
// silently misses the trimmed events; the client heals by refetching the
// detail snapshot when its stream completes (see useSession), so the cap
// trades a rare extra refetch for bounded memory.
const MAX_BUFFER_EVENTS = 1500;
let nextStreamEventIdSeed = Date.now();

function createInitialEventId(): number {
  nextStreamEventIdSeed = Math.max(Date.now(), nextStreamEventIdSeed + 1);
  return nextStreamEventIdSeed;
}

function getLastAssistantResponse(messages: Session["messages"]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "assistant" && message.content.trim().length > 0) {
      return message.content;
    }
  }

  return "";
}

// ============================================================================
// Public Entry Points
// ============================================================================

/** Opens the client-facing session event stream. Without a prompt, attach to
 *  an existing runtime stream and replay buffered events; with a prompt,
 *  create/resume the SDK session, subscribe first, then send the prompt. */
export async function* createClientSessionStream(
  options: SessionStreamConfig,
): AsyncGenerator<SessionEvent> {
  const stream = SessionStream.get(options.sessionId);

  if (!options.prompt) {
    if (stream) yield* attachToRuntimeStream(stream, options.afterEventId);
    return;
  }

  const messageOptions: SendOrQueueSessionMessageOptions = {
    ...options,
    message: {
      id: options.clientMessageId ?? crypto.randomUUID(),
      role: "user",
      content: options.prompt,
      attachments: options.attachments,
      modelConfiguration: options.modelConfiguration,
    },
  };

  if (stream) {
    if (!options.startNew) {
      queueMessageForNextTurn(stream, messageOptions);
      return;
    }

    // Stale draft retry: the original turn already exists, so attach to it
    // instead of sending or queueing a duplicate prompt.
    yield* attachToRuntimeStream(stream, options.afterEventId);
    return;
  }

  const runtime = await createOrResumePromptStream(messageOptions);
  yield* streamMessageTurn(runtime, messageOptions);
}

/** Delivers a prompt from a background/tool caller. No client is waiting for
 *  streamed events here, so an active target session means queue for the next
 *  turn; an idle target session means resume/create and send immediately. */
export async function sendOrQueueSessionMessage(
  options: SendOrQueueSessionMessageOptions,
): Promise<void> {
  const existing = SessionStream.get(options.sessionId);
  if (existing) {
    // A `startNew` request against a live stream is a stale draft retry (the
    // draft sender raced or retried). The turn already exists, so do not send
    // or queue the prompt again.
    if (options.startNew) {
      return;
    }

    queueMessageForNextTurn(existing, options);
    return;
  }

  try {
    await startPromptTurn(options);
  } catch (error) {
    // A stale cached SDK handle (possible on the snapshot-seed path, which
    // skips the replay path's getEvents probe) surfaces as a send failure
    // after the send's catch evicted it and closed the stream. Background
    // senders have no user to retry, so rebuild once — the resume is fresh by
    // construction and the cached snapshot is still valid (the log never
    // changed).
    if (!evictCachedSessionIfStale(options.sessionId, error)) throw error;

    await startPromptTurn(options);
  }
}

function attachToRuntimeStream(
  stream: SessionStream,
  afterEventId?: number,
): AsyncGenerator<SessionEvent> {
  return yieldStreamEvents(stream, {
    afterEventId,
    replayBuffer: true,
  });
}

type PromptStreamRuntime = {
  stream: SessionStream;
  sdkSession: CopilotSession;
};

async function createOrResumePromptStream(
  options: SendOrQueueSessionMessageOptions,
): Promise<PromptStreamRuntime> {
  if (options.startNew) {
    const sdkSession = await createSession(options.sessionId, {
      modelConfiguration: modelConfigurationForMessage(options.message),
      directory: options.directory,
      useWorktree: options.useWorktree,
    });
    return {
      sdkSession,
      stream: SessionStream.getOrCreate(options.sessionId, sdkSession, {
        modelConfiguration: modelConfigurationForMessage(options.message),
      }),
    };
  }

  // A fresh cached snapshot is the same state a history replay would produce
  // — captured from the live reducer at clean close, or by an actual replay
  // on a cold read — so seed the stream from it and skip the SDK history
  // fetch and replay. Any doubt (no entry, stale or missing log, expired)
  // falls through to the replay path below.
  const cachedSnapshot = await getCachedSnapshot(options.sessionId);
  if (cachedSnapshot) {
    const sdkSession = await getCachedOrResumeSession(options.sessionId);
    return {
      sdkSession,
      stream: SessionStream.getOrCreate(
        options.sessionId,
        sdkSession,
        sessionSeedFromSnapshot(cachedSnapshot),
      ),
    };
  }

  const resumed = await getOrResumeSession(options.sessionId);
  return {
    sdkSession: resumed.session,
    stream: SessionStream.getOrCreate(
      options.sessionId,
      resumed.session,
      await initializeSessionStateFromSdkHistory(resumed.events),
    ),
  };
}

/** Build the prompt-stream runtime and send the message as a new turn — one
 *  complete background send attempt. */
async function startPromptTurn(options: SendOrQueueSessionMessageOptions): Promise<void> {
  const { stream, sdkSession } = await createOrResumePromptStream(options);
  await startTurnAndSendMessage(stream, sdkSession, options);
}

function streamMessageTurn(
  runtime: PromptStreamRuntime,
  options: SendOrQueueSessionMessageOptions,
): AsyncGenerator<SessionEvent> {
  return yieldStreamEvents(runtime.stream, {
    replayBuffer: false,
    afterSubscribe: () => startTurnAndSendMessage(runtime.stream, runtime.sdkSession, options),
  });
}

function queueMessageForNextTurn(
  stream: SessionStream,
  options: SendOrQueueSessionMessageOptions,
): void {
  // Coalesce equivalent notifications (e.g. repeated edits to one artifact) so the agent
  // isn't nudged twice for the same thing. Normal prompts have no key and pass through.
  const coalesceKey = coalesceKeyForMessage(options.message);
  if (
    coalesceKey &&
    stream.getQueuedMessages().some((message) => coalesceKeyForMessage(message) === coalesceKey)
  ) {
    return;
  }

  stream.addQueuedMessage(options.message);
}

function coalesceKeyForMessage(message: QueuedMessage): string | undefined {
  return message.role === "agent_notification"
    ? notificationCoalesceKey(message.notification)
    : undefined;
}

async function startTurnAndSendMessage(
  stream: SessionStream,
  sdkSession: CopilotSession,
  options: SendOrQueueSessionMessageOptions,
): Promise<void> {
  stream.startTurn(options.message);

  const modelConfiguration = modelConfigurationForMessage(options.message);
  if (modelConfiguration?.model) {
    await stream.setModel(modelConfiguration);
  }

  try {
    await sdkSession.send({
      prompt: sdkPromptForMessage(options.message),
      attachments: toSdkAttachmentBlobs(attachmentsForMessage(options.message)),
    });
  } catch (error) {
    // The turn never started on the SDK: fully close (not just finish) so no
    // dead stream stays registered, and drop the session handle if the SDK
    // no longer knows the session so a retry resumes fresh.
    evictCachedSessionIfStale(stream.sessionId, error);
    stream.close();
    throw error;
  }
}

function sdkPromptForMessage(message: QueuedMessage): string {
  return message.role === "agent_notification"
    ? encodeSdkAgentNotification(message.notification)
    : message.content;
}

function attachmentsForMessage(message: QueuedMessage): Attachment[] | undefined {
  return message.role === "user" ? message.attachments : undefined;
}

function modelConfigurationForMessage(message: QueuedMessage): ModelConfiguration | undefined {
  return message.role === "user" ? message.modelConfiguration : undefined;
}

type StreamSubscriptionOptions = {
  afterEventId?: number;
  replayBuffer: boolean;
  afterSubscribe?: () => Promise<void>;
};

async function* yieldStreamEvents(
  stream: SessionStream,
  options: StreamSubscriptionOptions,
): AsyncGenerator<SessionEvent> {
  const { push, pull } = createAsyncQueue<SessionEvent>();
  const unsubscribe = stream.subscribe(push);

  try {
    const promptSend = options.afterSubscribe?.();
    promptSend?.catch(() => push(null));

    if (options.replayBuffer) {
      for (const event of stream.getBufferSince(options.afterEventId)) {
        yield event;
      }
    }

    // Stream live events until the runtime signals completion (null).
    while (true) {
      const event = await pull();
      if (event === null) {
        await promptSend;
        break;
      }

      yield event;
    }
  } finally {
    unsubscribe();
  }
}

/** Minimal single-consumer async queue bridging push-based subscribers to the
 *  pull-based async generator below. Only one pull may be outstanding. */
function createAsyncQueue<T>() {
  const queue: (T | null)[] = [];
  let resolve: ((value: T | null) => void) | null = null;

  return {
    push(item: T | null) {
      if (resolve) {
        resolve(item);
        resolve = null;
      } else {
        queue.push(item);
      }
    },
    pull(): Promise<T | null> {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift()!);
      }
      return new Promise((r) => {
        resolve = r;
      });
    },
  };
}

// ============================================================================
// SessionStream Runtime
// ============================================================================

// Dev HMR can reload this module while active turns are still running. Keep the
// registry on globalThis so reconnects and stop requests keep finding the same
// runtime object. A registered stream is therefore expected to mean "active or
// reconnectable"; terminal paths must close/detach so idle sessions disappear.
const sessionStreams = sharedMap<SessionStream>("session-streams");

export class SessionStream {
  // ── Static registry ──────────────────────────────────────────────────

  private static readonly streams = sessionStreams;

  static get(sessionId: string): SessionStream | undefined {
    return SessionStream.streams.get(sessionId);
  }

  static getOrCreate(
    sessionId: string,
    session: CopilotSession,
    initialState?: Partial<Session>,
  ): SessionStream {
    const existing = SessionStream.streams.get(sessionId);
    if (existing) {
      return existing;
    }

    const stream = new SessionStream(sessionId, session, initialState);
    SessionStream.streams.set(sessionId, stream);
    return stream;
  }

  /** Full-close a stream by session ID. No-op if no stream exists. */
  static close(sessionId: string): void {
    SessionStream.streams.get(sessionId)?.close();
  }

  /** Remove a stream without emitting lifecycle events (for session deletion). */
  static remove(sessionId: string): void {
    SessionStream.streams.get(sessionId)?.detach();
  }

  static getRunningSessionIds(): string[] {
    return Array.from(SessionStream.streams.keys());
  }

  static isRunning(sessionId: string): boolean {
    return SessionStream.streams.has(sessionId);
  }

  static async waitForClose(sessionId: string, timeoutMs?: number): Promise<string> {
    const stream = SessionStream.get(sessionId);
    if (!stream) {
      const cachedSnapshot = await getCachedSnapshot(sessionId);
      if (cachedSnapshot) {
        return getLastAssistantResponse(cachedSnapshot.messages);
      }

      const { events } = await getOrResumeSession(sessionId);
      return getLastAssistantResponse(
        (await initializeSessionStateFromSdkHistory(events)).messages,
      );
    }
    return stream.waitForClose(timeoutMs);
  }

  // ── Instance fields ──────────────────────────────────────────────────

  readonly sessionId: string;
  private readonly sdkSession: CopilotSession;

  // Event buffer
  #buffer: SessionEvent[] = [];

  // Subscribers
  readonly #subscribers = new Set<SessionStreamSubscriber>();
  readonly #closeWaiters = new Set<() => void>();

  // SDK event listener
  #unsubscribeSdk: () => void;

  // Live session state. This survives turn boundaries; only the reconnect
  // buffer is turn-scoped.
  #sessionState: Session;
  #projectionState = createProjectionState();

  // Event sequencing
  #nextEventId = createInitialEventId();
  #currentTurnId: string | undefined;
  #isDrainingQueue = false;

  private constructor(
    sessionId: string,
    sdkSession: CopilotSession,
    initialState?: Partial<Session>,
  ) {
    this.sessionId = sessionId;
    this.sdkSession = sdkSession;
    this.#sessionState = createInitialSession(initialState);
    this.#unsubscribeSdk = sdkSession.on((event) => this.#handleSdkEvent(event));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────
  // Teardown composes from two primitives so each step exists exactly once:
  //   finishStream = unread + replay cleanup + idle broadcast (keeps the runtime alive)
  //   detach       = waiters + SDK listener + registry (no lifecycle events)
  //   close        = finishStream + queue clear + end-of-stream + detach

  /** Full shutdown: buffer + queue + unread + broadcast + SDK listener. */
  close(): void {
    this.finishStream();
    this.#sessionState.queuedMessages.length = 0;
    this.#broadcastToSubscribers(null);
    this.detach();
  }

  /** Abort the in-flight turn on the SDK and close the stream. */
  async abort(): Promise<void> {
    await this.sdkSession.abort();
    this.close();
  }

  /** Lightweight cleanup: unsubscribe SDK + remove from registry.
   *  Used when the stream already closed normally and we just need
   *  to clean up the runtime object itself. */
  detach(): void {
    this.#resolveCloseWaiters();
    this.#unsubscribeSdk();
    SessionStream.streams.delete(this.sessionId);
  }

  /** Finish the active stream lifecycle: mark read/unread, clear replay state,
   *  and broadcast idle. */
  finishStream(): void {
    this.#updateUnreadOnStreamEnd();
    this.#clearReplayBuffer();
    emitSessionIdle(this.sessionId);
  }

  // ── Model ───────────────────────────────────────────────────────────

  get model(): string | undefined {
    return this.#sessionState.modelConfiguration?.model;
  }

  /** Update model options on both the SDK session and live stream state. */
  async setModel(configuration: ModelConfiguration): Promise<void> {
    if (!configuration.model) return;

    if (areModelConfigurationsEqual(configuration, this.#sessionState.modelConfiguration)) {
      return;
    }

    await this.sdkSession.setModel(configuration.model, toSdkSetModelOptions(configuration));
    this.#emit({
      type: "model_changed",
      modelConfiguration: configuration,
    });
  }

  // ── Buffer ───────────────────────────────────────────────────────────

  #appendToBuffer(event: SessionEvent): void {
    this.#buffer.push(event);
    if (this.#buffer.length > MAX_BUFFER_EVENTS) {
      this.#buffer.splice(0, this.#buffer.length - MAX_BUFFER_EVENTS);
    }
  }

  #clearReplayBuffer(): void {
    this.#buffer.length = 0;
  }

  /** Snapshot of buffered events after the given cursor. Returns a copy so
   *  replay iteration never races live appends (which would double-deliver). */
  getBufferSince(afterEventId?: number): SessionEvent[] {
    if (afterEventId === undefined) return [...this.#buffer];

    return this.#buffer.filter(
      (event) => event.eventId === undefined || event.eventId > afterEventId,
    );
  }

  getSessionState(): Session {
    return this.#sessionState;
  }

  // ── Queue ────────────────────────────────────────────────────────────

  getQueuedMessages(): QueuedMessage[] {
    return this.#sessionState.queuedMessages;
  }

  addQueuedMessage(message: QueuedMessage): QueuedMessage {
    this.#emit({
      type: "message_queued",
      message,
    });

    return message;
  }

  removeQueuedMessage(queuedMessageId: string): boolean {
    const index = this.#sessionState.queuedMessages.findIndex((m) => m.id === queuedMessageId);
    if (index === -1) return false;

    this.#emit({
      type: "message_cancelled",
      queuedMessageId,
    });

    return true;
  }

  // ── Subscriber management ───────────────────────────────────────────

  subscribe(fn: SessionStreamSubscriber): () => void {
    this.#subscribers.add(fn);

    return () => {
      this.#subscribers.delete(fn);
      if (this.#isIdle()) this.detach();
    };
  }

  #broadcastToSubscribers(event: SessionEvent | null): void {
    for (const subscriber of this.#subscribers) {
      subscriber(event);
    }
  }

  #resolveCloseWaiters(): void {
    if (this.#closeWaiters.size === 0) return;
    for (const resolve of this.#closeWaiters) {
      resolve();
    }
    this.#closeWaiters.clear();
  }

  #isCurrentStream(): boolean {
    return SessionStream.get(this.sessionId) === this;
  }

  /** Wait for this specific runtime stream instance to end.
   *  This intentionally does not observe future streams that might reuse the
   *  same session ID after this instance closes. */
  waitForClose(timeoutMs?: number): Promise<string> {
    if (!this.#isCurrentStream()) {
      return Promise.resolve(getLastAssistantResponse(this.#sessionState.messages));
    }

    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.#closeWaiters.delete(finish);
        resolve(getLastAssistantResponse(this.#sessionState.messages));
      };

      this.#closeWaiters.add(finish);

      if (!this.#isCurrentStream()) {
        finish();
        return;
      }

      if (timeoutMs !== undefined && timeoutMs >= 0) {
        timer = setTimeout(finish, timeoutMs);
      }
    });
  }

  #updateUnreadOnStreamEnd(): void {
    if (this.#subscribers.size > 0) {
      markSessionRead(this.sessionId);
    } else {
      markSessionUnread(this.sessionId);
    }
  }

  /** True when no subscribers are attached, nothing is queued, and the
   *  buffer is empty — safe to detach without losing state. */
  #isIdle(): boolean {
    return (
      this.#subscribers.size === 0 &&
      !this.#isDrainingQueue &&
      this.#sessionState.queuedMessages.length === 0 &&
      this.#buffer.length === 0
    );
  }

  // ── Event pipeline ──────────────────────────────────────────────────

  /** Begin a new turn: reset state, emit the user message, and prepare
   *  the buffer for incoming assistant events. */
  startTurn(message: QueuedMessage): void {
    this.#prepareForNewTurn();
    if (message.role === "agent_notification") {
      this.#emit({
        type: "agent_notification",
        notification: message.notification,
      });
      return;
    }

    this.#emit({
      type: "user_message",
      content: message.content,
      attachments: message.attachments,
      clientMessageId: message.id,
    });
  }

  #emit(event: SessionEvent, sourceEventType?: string): void {
    const decorated = this.#decorateEvent(event, sourceEventType);

    this.#appendToBuffer(decorated);
    applySessionEvent(this.#sessionState, decorated);
    this.#broadcastToSubscribers(decorated);
  }

  #prepareForNewTurn(): void {
    this.#clearReplayBuffer();

    this.#currentTurnId = this.#generateTurnId();
    prepareSessionForNextTurn(this.#sessionState);

    emitSessionRunning(this.sessionId);
  }

  #generateTurnId(): string {
    return `${this.sessionId}:turn:${Date.now().toString(36)}:${this.#nextEventId}`;
  }

  #decorateEvent(event: SessionEvent, sourceEventType?: string): SessionEvent {
    if (sourceEventType === "assistant.turn_start") {
      this.#currentTurnId = this.#generateTurnId();
    } else if (!this.#currentTurnId) {
      // Events arriving before any turn boundary (e.g. attaching to a
      // resumed session mid-turn) share a stable bootstrap turn id.
      this.#currentTurnId = `${this.sessionId}:turn:bootstrap`;
    }
    const eventId = this.#nextEventId++;
    return { ...event, eventId, turnId: this.#currentTurnId };
  }

  // ── SDK event handling ──────────────────────────────────────────────

  #handleSdkEvent(sdkEvent: SdkSessionEvent): void {
    const metadataPatch = getSdkMetadataPatch(sdkEvent);
    if (metadataPatch) {
      updateSessionSummary(this.sessionId, metadataPatch.summary, {
        replace: metadataPatch.replaceSummary,
      });
    }

    const streamTerminal = getSdkStreamTerminalDisposition(sdkEvent.type);
    if (streamTerminal) {
      if (streamTerminal === "error") {
        this.close();
        return;
      }
      this.#drainMessageQueue();
      return;
    }

    const projectedEvents = projectSdkEvent(sdkEvent, this.#projectionState);
    for (const sessionEvent of projectedEvents) {
      this.#emit(sessionEvent, sdkEvent.type);
    }
  }

  // ── Snapshot capture ────────────────────────────────────────────────

  /** Cache the final reduced state at the clean-close funnel — the one
   *  moment every successful turn sequence passes through with nothing
   *  pending. Normalizes with the reducer's idempotent end event first so
   *  the cached snapshot cannot disagree with a cold replay of the same
   *  log. Abort/error closes skip capture on purpose: their live state may
   *  hold streamed content that was never persisted. */
  #cacheFinalSnapshot(): void {
    applySessionEvent(this.#sessionState, { type: "end", reason: "idle" });
    cacheSnapshot(this.sessionId, toSessionSnapshot(this.sessionId, this.#sessionState));
  }

  // ── Queue draining ──────────────────────────────────────────────────

  async #drainMessageQueue(): Promise<void> {
    if (this.#isDrainingQueue) return;
    this.#isDrainingQueue = true;

    try {
      const queuedMessage = this.#sessionState.queuedMessages[0];
      if (!queuedMessage) {
        this.#cacheFinalSnapshot();
        this.close();
        return;
      }

      this.#prepareForNewTurn();

      // Emit removes the message from #sessionState.queuedMessages via applySessionEvent.
      this.#emit({
        type: "message_dequeued",
        message: queuedMessage,
      });

      const attachments = toSdkAttachmentBlobs(attachmentsForMessage(queuedMessage));
      const modelConfiguration = modelConfigurationForMessage(queuedMessage);

      if (modelConfiguration?.model) {
        await this.setModel(modelConfiguration);
      }

      await this.sdkSession.send({ prompt: sdkPromptForMessage(queuedMessage), attachments });
    } catch (err) {
      evictCachedSessionIfStale(this.sessionId, err);
      this.close();
    } finally {
      this.#isDrainingQueue = false;
    }
  }
}
