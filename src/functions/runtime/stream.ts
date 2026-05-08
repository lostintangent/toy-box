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
import {
  createProjectionState,
  getSdkMetadataPatch,
  getSdkStreamTerminalDisposition,
  type SdkSessionEvent,
  projectSdkEvent,
} from "@/functions/sdk/projector";
import { initializeSessionStateFromSdkHistory } from "@/functions/sdk/sessionState";
import type { Attachment, QueuedMessage, SessionEvent } from "@/types";
import type { Session } from "@/lib/session/sessionReducer";

export function prepareSessionForNextTurn(state: Session): Session {
  state.status = "thinking";
  state.reasoningContent = "";
  state.pendingToolCalls.clear();
  state.pendingOptimisticUserMessage = undefined;
  return state;
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

export type SendOrQueueSessionMessageOptions = {
  sessionId: string;
  prompt: string;
  attachments?: Attachment[];
  model?: string;
  directory?: string;
  useWorktree?: boolean;
  clientMessageId?: string;
  startNew?: boolean;
};

export type SendOrQueueSessionMessageResult = {
  stream: SessionStream;
  disposition: "queued" | "started" | "attached";
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
    initialState?: Partial<Session>,
  ): SessionStream {
    const existing = SessionStream.streams.get(sessionId);
    if (existing) return existing;

    const stream = new SessionStream(sessionId, session);
    stream.#sessionState = createInitialSession(initialState);
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
  #nextEventId = 1;
  #currentTurnId: string | undefined;
  #isDrainingQueue = false;

  // ── Constructor ──────────────────────────────────────────────────────

  private constructor(sessionId: string, sdkSession: CopilotSession) {
    this.sessionId = sessionId;
    this.sdkSession = sdkSession;
    this.#sessionState = createInitialSession();
    this.#unsubscribeSdk = sdkSession.on((event) => this.#handleSdkEvent(event));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /** Full shutdown: buffer + queue + unread + broadcast + SDK listener. */
  close(): void {
    this.#resolveCloseWaiters();
    this.#updateUnreadOnStreamEnd();
    this.#clearBuffer();
    this.#sessionState.queuedMessages.length = 0;
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
    return this.#sessionState.model;
  }

  /** Update the model on both the SDK session and local state. */
  async setModel(model: string): Promise<void> {
    if (model === this.#sessionState.model) return;

    await this.sdkSession.setModel(model);
    this.#sessionState.model = model;
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

    this.#applyEvent(decorated);
    this.#broadcastToSubscribers(decorated);
  }

  #prepareForNewTurn(summaryHint?: string): void {
    this.#prepareBuffer(summaryHint);
    this.#currentTurnId = undefined;
    prepareSessionForNextTurn(this.#sessionState);
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
    applySessionEvent(this.#sessionState, event);
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
      const queuedMessage = this.#sessionState.queuedMessages[0];
      if (!queuedMessage) {
        this.close();
        return;
      }

      this.#prepareForNewTurn(queuedMessage.content);
      this.#currentTurnId = this.#generateTurnId();

      // Emit removes the message from #sessionState.queuedMessages via applySessionEvent.
      this.#emit({
        type: "message_dequeued",
        content: queuedMessage.content,
        queuedMessageId: queuedMessage.id,
      });

      const attachments = await writeAttachments(this.sessionId, queuedMessage.attachments);

      if (queuedMessage.model && queuedMessage.model !== this.#sessionState.model) {
        await this.setModel(queuedMessage.model);
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
  const prompt = options.prompt;
  let stream = SessionStream.get(options.sessionId);
  const shouldStartNew = Boolean(options.startNew && !stream);
  const shouldAttachToExistingStream = Boolean(options.startNew && stream);

  // Auto-queue: if the session is already streaming and this is not a stale
  // draft retry, enqueue instead of corrupting the in-flight turn.
  if (stream && !shouldAttachToExistingStream) {
    stream.addQueuedMessage({
      role: "user",
      content: prompt,
      attachments: options.attachments,
      model: options.model,
    });
    return { stream, disposition: "queued" };
  }

  let sdkSession: CopilotSession | undefined;

  if (!stream) {
    if (shouldStartNew) {
      sdkSession = await createSession(options.sessionId, {
        model: options.model,
        directory: options.directory,
        useWorktree: options.useWorktree,
      });
      stream = SessionStream.getOrCreate(options.sessionId, sdkSession, {
        model: options.model,
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
  }

  if (shouldAttachToExistingStream) {
    return { stream, disposition: "attached" };
  }

  if (!stream || !sdkSession) {
    throw new Error(`Failed to prepare session ${options.sessionId} for prompt delivery.`);
  }

  stream.startTurn(prompt, options.clientMessageId);

  if (options.model) {
    await stream.setModel(options.model);
  }
  const attachments = await writeAttachments(options.sessionId, options.attachments);
  try {
    await sdkSession.send({ prompt, attachments });
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
      model: options.model,
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
      // A stale `startNew` request from a retried or racing draft sender lands
      // here as well, so it attaches to the existing turn instead of sending
      // or queueing a duplicate prompt.
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
