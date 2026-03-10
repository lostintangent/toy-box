// Session streaming runtime — bridges the Copilot SDK's event-driven session
// model to the HTTP streaming interface consumed by the client. Owns the
// per-session event pipeline (SDK event → projected SessionEvent → streaming
// buffer → SSE listener), turn lifecycle, and the queued-message drain loop
// that sends follow-up prompts between turns.
//
// The SessionStream class encapsulates all per-stream state: the event buffer,
// queued messages, subscribers, SDK listener, and reducer state. External
// callers use the static registry (get / getOrCreate / close) and instance
// methods — never reaching into internal fields directly.

import type { CopilotSession } from "@github/copilot-sdk";
import { createSession, getOrResumeSession } from "../state/sessionCache";
import { markSessionUnread, markSessionRead } from "../state/unread";
import { writeAttachments } from "../state/attachments";
import {
  emitSessionRunning,
  emitSessionIdle,
  emitSessionTouched,
  updateSessionSummary,
} from "./broadcast";
import { applySessionEvent, createInitialSession } from "@/lib/session/sessionReducer";
import { type SdkSessionEvent, readSessionModel } from "@/functions/sdk/extractors";
import {
  createProjectionState,
  getSdkMetadataPatch,
  getSdkStreamTerminalDisposition,
  projectSdkEvent,
} from "@/functions/sdk/projector";
import type { Attachment, QueuedMessage, SessionEvent } from "@/types";
import type { Session } from "@/lib/session/sessionReducer";

export type SessionStreamConfig = {
  sessionId: string;
  prompt?: string;
  attachments?: Attachment[];
  model?: string;
  directory?: string;
  useWorktree?: boolean;

  clientMessageId?: string;
  afterEventId?: number;
  startNew?: boolean;
};

type SessionStreamSubscriber = (event: SessionEvent | null) => void;

const MAX_BUFFER_EVENTS = 1500;

export class SessionStream {
  // ── Static registry ──────────────────────────────────────────────────

  private static readonly streams = new Map<string, SessionStream>();

  static get(sessionId: string): SessionStream | undefined {
    return SessionStream.streams.get(sessionId);
  }

  static getOrCreate(
    sessionId: string,
    session: CopilotSession,
    initialModel?: string,
  ): SessionStream {
    const existing = SessionStream.streams.get(sessionId);
    if (existing) return existing;

    const stream = new SessionStream(sessionId, session);
    if (initialModel) {
      stream.#turnState.model = initialModel;
    }
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

  // ── Instance fields ──────────────────────────────────────────────────

  readonly sessionId: string;
  private readonly sdkSession: CopilotSession;

  // Event buffer
  #buffer: SessionEvent[] = [];
  #lastEventId: number | undefined;
  #announcedRunning = false;

  // Subscribers
  readonly #subscribers = new Set<SessionStreamSubscriber>();

  // SDK event listener
  #unsubscribeSdk: () => void;

  // Reducer state
  #turnState: Session;
  #projectionState = createProjectionState();

  // Event sequencing
  #nextEventId = 1;
  #currentTurnId: string | undefined;
  #isDrainingQueue = false;

  // ── Constructor ──────────────────────────────────────────────────────

  private constructor(sessionId: string, sdkSession: CopilotSession) {
    this.sessionId = sessionId;
    this.sdkSession = sdkSession;
    this.#turnState = createInitialSession();
    this.#unsubscribeSdk = sdkSession.on((event) => this.#handleSdkEvent(event));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /** Full shutdown: buffer + queue + unread + broadcast + SDK listener. */
  close(): void {
    this.#updateUnreadOnStreamEnd();
    this.#clearBuffer();
    this.#turnState.queuedMessages.length = 0;
    this.#broadcastToSubscribers(null);
    this.#unsubscribeSdk();
    SessionStream.streams.delete(this.sessionId);
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
    return this.#turnState.model;
  }

  /** Update the model on both the SDK session and local state. */
  async setModel(model: string): Promise<void> {
    if (model === this.#turnState.model) return;

    await this.sdkSession.setModel(model);
    this.#turnState.model = model;
  }

  // ── Buffer ───────────────────────────────────────────────────────────

  /** Prepare buffer for a new turn. Emits "running" on the first call. */
  #prepareBuffer(summaryHint?: string): void {
    this.#buffer.length = 0;

    if (!this.#announcedRunning) {
      this.#announcedRunning = true;
      emitSessionRunning(this.sessionId);
    }

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

    if (!this.#announcedRunning) {
      this.#announcedRunning = true;
      emitSessionRunning(this.sessionId);
    }
  }

  #clearBuffer(): void {
    if (this.#buffer.length === 0 && !this.#announcedRunning) return;

    this.#buffer.length = 0;
    this.#lastEventId = undefined;

    if (this.#announcedRunning) {
      this.#announcedRunning = false;
      emitSessionIdle(this.sessionId);
    }
  }

  getBufferSince(afterEventId?: number): SessionEvent[] {
    if (afterEventId === undefined) return this.#buffer;
    if (this.#buffer.length === 0) return [];

    return this.#buffer.filter(
      (event) => event.eventId === undefined || event.eventId > afterEventId,
    );
  }

  getTurnState(): Session {
    return this.#turnState;
  }

  getLastEventId(): number | undefined {
    return this.#lastEventId;
  }

  // ── Queue ────────────────────────────────────────────────────────────

  getQueuedMessages(): QueuedMessage[] {
    return this.#turnState.queuedMessages;
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
    const index = this.#turnState.queuedMessages.findIndex((m) => m.id === queuedMessageId);
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
      this.#turnState.queuedMessages.length === 0 &&
      this.#buffer.length === 0
    );
  }

  // ── Event pipeline ──────────────────────────────────────────────────

  /** Begin a new turn: reset state, emit the user message, and prepare
   *  the buffer for incoming assistant events. */
  startTurn(prompt: string, clientMessageId?: string): void {
    this.#resetForNewTurn(prompt);
    this.#emit({
      type: "user_message",
      content: prompt,
      clientMessageId,
    });
  }

  #emit(event: SessionEvent, sourceEventType?: string): void {
    const decorated = this.#decorateEvent(event, sourceEventType);

    this.#applyEvent(decorated);
    this.#broadcastToSubscribers(decorated);
  }

  #resetForNewTurn(summaryHint?: string): void {
    this.#prepareBuffer(summaryHint);
    this.#currentTurnId = undefined;

    const currentModel = this.#turnState.model;
    this.#turnState = createInitialSession();
    this.#turnState.model = currentModel;
    this.#turnState.status = "thinking";
  }

  #generateTurnId(): string {
    return `${this.sessionId}:turn:${Date.now().toString(36)}:${this.#nextEventId}`;
  }

  #decorateEvent(event: SessionEvent, sourceEventType?: string): SessionEvent {
    if (sourceEventType === "assistant.turn_start") {
      this.#currentTurnId = this.#generateTurnId();
    } else if (!this.#currentTurnId) {
      this.#currentTurnId = `${this.sessionId}:turn:bootstrap`;
    }
    const eventId = this.#nextEventId++;
    return { ...event, eventId, turnId: this.#currentTurnId };
  }

  #applyEvent(event: SessionEvent): void {
    this.#appendToBuffer(event);
    applySessionEvent(this.#turnState, event);
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

    for (const sessionEvent of projectSdkEvent(sdkEvent, {
      streaming: true,
      state: this.#projectionState,
    })) {
      if (
        (sessionEvent.type === "delta" || sessionEvent.type === "reasoning") &&
        sessionEvent.content.length === 0
      ) {
        continue;
      }

      this.#emit(sessionEvent, sdkEvent.type);
    }
  }

  // ── Queue draining ──────────────────────────────────────────────────

  async #drainMessageQueue(): Promise<void> {
    if (this.#isDrainingQueue) return;
    this.#isDrainingQueue = true;

    try {
      const queuedMessage = this.#turnState.queuedMessages[0];
      if (!queuedMessage) {
        this.close();
        return;
      }

      this.#resetForNewTurn(queuedMessage.content);
      this.#currentTurnId = this.#generateTurnId();

      // Emit removes the message from #turnState.queuedMessages via applySessionEvent.
      this.#emit({
        type: "message_dequeued",
        content: queuedMessage.content,
        queuedMessageId: queuedMessage.id,
      });

      const attachments = await writeAttachments(this.sessionId, queuedMessage.attachments);

      if (queuedMessage.model && queuedMessage.model !== this.#turnState.model) {
        await this.sdkSession.setModel(queuedMessage.model);
        this.#turnState.model = queuedMessage.model;
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

/** Extract the last-known model from SDK history events (scans backwards). */
function getModelFromSdkEvents(events: SdkSessionEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const model = readSessionModel(events[i]);
    if (model) return model;
  }
  return undefined;
}

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

export async function* createSessionEventStream(
  options: SessionStreamConfig,
): AsyncGenerator<SessionEvent> {
  const shouldStartNew = Boolean(options.startNew && options.prompt);
  const hasPrompt = !!options.prompt;

  // Reconnect with no prompt and no active stream — nothing to do.
  if (!hasPrompt && !SessionStream.isRunning(options.sessionId)) {
    return;
  }

  // Auto-queue: if the session is already streaming and a new prompt arrives,
  // enqueue it instead of corrupting the in-flight turn.
  if (hasPrompt && !shouldStartNew && SessionStream.isRunning(options.sessionId)) {
    const stream = SessionStream.get(options.sessionId)!;
    stream.addQueuedMessage({
      role: "user",
      content: options.prompt!,
      attachments: options.attachments,
      model: options.model,
    });

    return;
  }

  let sdkSession: CopilotSession;
  let sdkModel: string | undefined;

  if (shouldStartNew) {
    sdkSession = await createSession(options.sessionId, {
      model: options.model,
      directory: options.directory,
      useWorktree: options.useWorktree,
    });
    sdkModel = options.model;
  } else {
    const resumed = await getOrResumeSession(options.sessionId);
    sdkSession = resumed.session;
    sdkModel = getModelFromSdkEvents(resumed.events);
  }

  const stream = SessionStream.getOrCreate(options.sessionId, sdkSession, sdkModel);

  const { push, pull } = createAsyncQueue<SessionEvent>();
  const unsubscribe = stream.subscribe(push);

  try {
    if (hasPrompt) {
      // Send path: start a new turn, set model if changed, send to SDK.
      stream.startTurn(options.prompt!, options.clientMessageId);

      if (options.model) {
        await stream.setModel(options.model);
      }
      const attachments = await writeAttachments(options.sessionId, options.attachments);
      try {
        await sdkSession.send({ prompt: options.prompt!, attachments });
      } catch (error) {
        stream.markSendFailure();
        throw error;
      }
    } else {
      // Reconnect path: replay buffered events then wait for live events.
      // The early-return guard above ensures a stream is always active here.
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
