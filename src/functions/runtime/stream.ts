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

import type { CopilotSession } from "@github/copilot-sdk";
import { createSession, getOrResumeSession } from "../state/sessionCache";
import { markSessionUnread, markSessionRead } from "../state/unread";
import {
  emitSessionRunning,
  emitSessionIdle,
  emitSessionTouched,
  updateSessionSummary,
} from "./broadcast";
import {
  applySessionEvent,
  createInitialSession,
  prepareSessionForNextTurn,
} from "@/lib/session/sessionReducer";
import {
  createProjectionState,
  getSdkMetadataPatch,
  getSdkStreamTerminalDisposition,
  type SdkSessionEvent,
  projectSdkEvent,
} from "@/functions/sdk/projector";
import { initializeSessionStateFromSdkHistory } from "@/functions/sdk/historyReplay";
import { toSdkAttachmentBlobs } from "@/functions/sdk/attachments";
import type { Attachment, ModelConfiguration, QueuedMessage, SessionEvent } from "@/types";
import type { Session } from "@/lib/session/sessionReducer";
import { areModelConfigurationsEqual, toSdkSetModelOptions } from "@/lib/modelConfiguration";

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
  "prompt" | "afterEventId"
> & {
  prompt: string;
};

export type SendOrQueueSessionMessageResult = {
  stream: SessionStream;
  disposition: "queued" | "started" | "attached";
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
// SessionStream
// ============================================================================

export class SessionStream {
  // ── Static registry ──────────────────────────────────────────────────

  private static readonly streams = new Map<string, SessionStream>();

  static get(sessionId: string): SessionStream | undefined {
    return SessionStream.streams.get(sessionId);
  }

  static getOrCreate(
    sessionId: string,
    session: CopilotSession,
    initialState?: Partial<Session>,
  ): SessionStream {
    const existing = SessionStream.streams.get(sessionId);
    if (existing) return existing;

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
  #lastEventId: number | undefined;
  #announcedRunning = false;

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
  //   markSendFailure = unread + buffer cleanup (keeps the runtime alive)
  //   detach          = waiters + SDK listener + registry (no lifecycle events)
  //   close           = markSendFailure + queue clear + end-of-stream + detach

  /** Full shutdown: buffer + queue + unread + broadcast + SDK listener. */
  close(): void {
    this.markSendFailure();
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

  /** Mark a send failure: clear the buffer and update unread, but keep
   *  the runtime alive so the caller can still detach it. */
  markSendFailure(): void {
    this.#updateUnreadOnStreamEnd();
    this.#clearBuffer();
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

  /** Announce running/idle to the session list exactly once per transition. */
  #setAnnouncedRunning(running: boolean): void {
    if (this.#announcedRunning === running) return;
    this.#announcedRunning = running;
    if (running) {
      emitSessionRunning(this.sessionId);
    } else {
      emitSessionIdle(this.sessionId);
    }
  }

  /** Prepare buffer for a new turn. Emits "running" on the first call. */
  #prepareBuffer(summaryHint?: string): void {
    this.#buffer.length = 0;
    this.#setAnnouncedRunning(true);
    emitSessionTouched(this.sessionId, { summary: summaryHint });
  }

  #appendToBuffer(event: SessionEvent): void {
    if (event.eventId !== undefined) {
      this.#lastEventId = event.eventId;
    }

    this.#buffer.push(event);
    if (this.#buffer.length > MAX_BUFFER_EVENTS) {
      this.#buffer.splice(0, this.#buffer.length - MAX_BUFFER_EVENTS);
    }

    this.#setAnnouncedRunning(true);
  }

  #clearBuffer(): void {
    this.#buffer.length = 0;
    this.#lastEventId = undefined;
    this.#setAnnouncedRunning(false);
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

  getLastEventId(): number | undefined {
    return this.#lastEventId;
  }

  // ── Queue ────────────────────────────────────────────────────────────

  getQueuedMessages(): QueuedMessage[] {
    return this.#sessionState.queuedMessages;
  }

  addQueuedMessage(message: Omit<QueuedMessage, "id"> & { id?: string }): QueuedMessage {
    const queued: QueuedMessage = {
      ...message,
      role: "user",
      id: message.id ?? crypto.randomUUID(),
    };

    this.#emit({
      type: "message_queued",
      queuedMessageId: queued.id,
      content: queued.content,
      attachments: queued.attachments,
    });

    return queued;
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
  startTurn(prompt: string, clientMessageId?: string): void {
    this.#prepareForNewTurn(prompt);
    this.#emit({
      type: "user_message",
      content: prompt,
      clientMessageId,
    });
  }

  #emit(event: SessionEvent, sourceEventType?: string): void {
    const decorated = this.#decorateEvent(event, sourceEventType);

    this.#appendToBuffer(decorated);
    applySessionEvent(this.#sessionState, decorated);
    this.#broadcastToSubscribers(decorated);
  }

  #prepareForNewTurn(summaryHint?: string): void {
    this.#prepareBuffer(summaryHint);
    this.#currentTurnId = this.#generateTurnId();
    prepareSessionForNextTurn(this.#sessionState);
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

    for (const sessionEvent of projectSdkEvent(sdkEvent, this.#projectionState)) {
      this.#emit(sessionEvent, sdkEvent.type);
    }
  }

  // ── Queue draining ──────────────────────────────────────────────────

  async #drainMessageQueue(): Promise<void> {
    if (this.#isDrainingQueue) return;
    this.#isDrainingQueue = true;

    try {
      const queuedMessage = this.#sessionState.queuedMessages[0];
      if (!queuedMessage) {
        this.close();
        return;
      }

      this.#prepareForNewTurn(queuedMessage.content);

      // Emit removes the message from #sessionState.queuedMessages via applySessionEvent.
      this.#emit({
        type: "message_dequeued",
        content: queuedMessage.content,
        queuedMessageId: queuedMessage.id,
      });

      const attachments = toSdkAttachmentBlobs(queuedMessage.attachments);

      if (queuedMessage.modelConfiguration?.model) {
        await this.setModel(queuedMessage.modelConfiguration);
      }

      await this.sdkSession.send({ prompt: queuedMessage.content, attachments });
    } catch (err) {
      console.error(`[DRAIN] ${this.sessionId} error:`, err);
      this.close();
    } finally {
      this.#isDrainingQueue = false;
    }
  }
}

// ============================================================================
// Streaming Entry Point
// ============================================================================

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

/** Deliver a prompt to a session without making the caller care whether it
 *  needs to be queued behind an active turn, attached to an existing draft
 *  stream, or sent immediately by resuming/starting the session. */
export async function sendOrQueueSessionMessage(
  options: SendOrQueueSessionMessageOptions,
): Promise<SendOrQueueSessionMessageResult> {
  const existing = SessionStream.get(options.sessionId);
  if (existing) {
    // A `startNew` request against a live stream is a stale draft retry (the
    // draft sender raced or retried) — attach to the in-flight turn instead
    // of sending or queueing a duplicate prompt.
    if (options.startNew) {
      return { stream: existing, disposition: "attached" };
    }

    // Auto-queue: the session is already streaming; enqueue instead of
    // corrupting the in-flight turn.
    existing.addQueuedMessage({
      role: "user",
      content: options.prompt,
      attachments: options.attachments,
      modelConfiguration: options.modelConfiguration,
    });
    return { stream: existing, disposition: "queued" };
  }

  let sdkSession: CopilotSession;
  let stream: SessionStream;
  if (options.startNew) {
    sdkSession = await createSession(options.sessionId, {
      modelConfiguration: options.modelConfiguration,
      directory: options.directory,
      useWorktree: options.useWorktree,
    });
    stream = SessionStream.getOrCreate(options.sessionId, sdkSession, {
      modelConfiguration: options.modelConfiguration,
    });
  } else {
    const resumed = await getOrResumeSession(options.sessionId);
    sdkSession = resumed.session;
    stream = SessionStream.getOrCreate(
      options.sessionId,
      sdkSession,
      await initializeSessionStateFromSdkHistory(resumed.events),
    );
  }

  stream.startTurn(options.prompt, options.clientMessageId);

  if (options.modelConfiguration?.model) {
    await stream.setModel(options.modelConfiguration);
  }
  try {
    await sdkSession.send({
      prompt: options.prompt,
      attachments: toSdkAttachmentBlobs(options.attachments),
    });
  } catch (error) {
    stream.markSendFailure();
    throw error;
  }

  return { stream, disposition: "started" };
}

export async function* createSessionEventStream(
  options: SessionStreamConfig,
): AsyncGenerator<SessionEvent> {
  const hasPrompt = !!options.prompt;
  let stream = SessionStream.get(options.sessionId);
  let promptDisposition: SendOrQueueSessionMessageResult["disposition"] | undefined;

  // Reconnect with no prompt and no active stream — nothing to do.
  if (!hasPrompt && !stream) {
    return;
  }

  if (hasPrompt) {
    const delivery = await sendOrQueueSessionMessage({
      sessionId: options.sessionId,
      prompt: options.prompt!,
      attachments: options.attachments,
      modelConfiguration: options.modelConfiguration,
      directory: options.directory,
      useWorktree: options.useWorktree,
      clientMessageId: options.clientMessageId,
      startNew: options.startNew,
    });
    if (delivery.disposition === "queued") {
      return;
    }
    stream = delivery.stream;
    promptDisposition = delivery.disposition;
  }

  if (!stream) {
    return;
  }

  const { push, pull } = createAsyncQueue<SessionEvent>();
  const unsubscribe = stream.subscribe(push);

  try {
    if (!hasPrompt || promptDisposition === "attached") {
      // Reconnect path: replay buffered events then wait for live events.
      for (const event of stream.getBufferSince(options.afterEventId)) {
        yield event;
      }
    }

    // Stream live events until the runtime signals completion (null).
    while (true) {
      const event = await pull();
      if (event === null) break;

      yield event;
    }
  } finally {
    unsubscribe();
  }
}
