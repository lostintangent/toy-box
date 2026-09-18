// One live session runtime. A SessionStream owns a provider connection,
// reduced live state, queued turns, completion waiters, and a replayable event
// bus. It is the one live execution path shared by connected and headless
// delivery.
//
// The event bus stamps eventId for reconnect cursors. Client-provided message
// identity is correlated separately when the provider echoes sent inputs.

import type { SessionConnection } from "@providers/server/provider";
import { evictCachedSessionIfStale, releaseSession } from "@sessions/server/state/registry";
import { cacheSnapshot, loadSessionSnapshot } from "@sessions/server/state/snapshots";
import { setSessionStatus } from "@workspace/server/state";
import { systemMessageCoalesceKey } from "@sessions/model/systemMessages";
import { areModelConfigurationsEqual } from "@sessions/model/modelConfiguration";
import type { SessionQuestionAnswer, SessionSubscriptionMode } from "@sessions/model/protocol";
import { applySessionEvent, createInitialSessionState } from "@sessions/model/reducer";
import { hasBlockingSessionQuestion, hasPendingSessionQuestion } from "@sessions/model/questions";
import type {
  SessionCompletion,
  SessionEvent,
  SessionMessage,
  SessionState,
} from "@sessions/model";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";
import { emitSessionNameUpdate } from "@workspace/server/events";
import { sharedMap } from "@/shared/server/processState";
import { createSessionEventBus, type SessionStreamSubscription } from "./eventBus";

type MessageDisposition = "started" | "queued";
type StreamEndReason = Extract<SessionEvent, { type: "end" }>["reason"];

// Replay retention cap. A client reconnecting across a gap larger than this
// silently misses the trimmed events; the client heals by refetching the
// detail snapshot when its stream completes (see useSession), so the cap
// trades a rare extra refetch for bounded memory.
const MAX_REPLAY_EVENTS = 1500;

// Dev HMR can reload this module while active turns are still running. Keep the
// registry on globalThis so reconnects and stop requests keep finding the same
// runtime object. A registered stream is therefore expected to mean "active or
// reconnectable"; terminal paths must finish or dispose it so idle sessions disappear.
export class SessionStream {
  // ── Static registry and controls ─────────────────────────────────────

  private static readonly streams = sharedMap<SessionStream>("session-streams");

  static get(sessionId: string): SessionStream | undefined {
    return SessionStream.streams.get(sessionId);
  }

  /** @internal acquireSessionStream is the production caller. */
  static getOrCreate(
    sessionId: string,
    session: SessionConnection,
    initialState?: Partial<SessionState>,
  ): SessionStream {
    const existing = SessionStream.streams.get(sessionId);
    if (existing) {
      return existing;
    }

    const stream = new SessionStream(sessionId, session, initialState);
    SessionStream.streams.set(sessionId, stream);
    return stream;
  }

  static isRunning(sessionId: string): boolean {
    return SessionStream.streams.has(sessionId);
  }

  static async waitForCompletion(
    sessionId: string,
    timeoutMs?: number,
  ): Promise<SessionCompletion> {
    const stream = SessionStream.get(sessionId);
    if (!stream) {
      return completionResult((await loadSessionSnapshot(sessionId)).messages);
    }
    return stream.waitForCompletion(timeoutMs);
  }

  /**
   * Remove the live runtime after its durable session is deleted elsewhere.
   * Subscribers receive a terminal event, but a deleted session publishes no
   * idle/unread update. Completion waiters still settle cleanly.
   */
  static remove(sessionId: string): void {
    const stream = SessionStream.streams.get(sessionId);
    if (!stream) return;

    if (!stream.#finished) stream.#emit({ type: "end", reason: "idle" });
    stream.#dispose();
  }

  // ── Instance fields ──────────────────────────────────────────────────

  readonly sessionId: string;
  /** Underlying provider session used by runtime-owned operations. */
  readonly connection: SessionConnection;

  #bus = createSessionEventBus(MAX_REPLAY_EVENTS);

  readonly #completionWaiters = new Set<() => void>();
  #unsubscribeProvider: () => void;

  // Live session state survives turn boundaries; only replay history is
  // turn-scoped.
  #sessionState: SessionState;

  // Claimed synchronously before #startTurn awaits so concurrent deliveries
  // cannot both open the stream's first turn.
  #hasOpenedTurn = false;
  #abortRequested = false;
  #finished = false;
  #completionResult: SessionCompletion | undefined;
  private constructor(
    sessionId: string,
    connection: SessionConnection,
    initialState?: Partial<SessionState>,
  ) {
    this.sessionId = sessionId;
    this.connection = connection;
    this.#sessionState = createInitialSessionState(initialState);

    this.#unsubscribeProvider = connection.onEvent((event) => this.#handleProviderEvent(event));
  }

  // ── Live stream surface ──────────────────────────────────────────────

  subscribe(
    afterEventId?: number,
    mode: SessionSubscriptionMode = "active",
  ): SessionStreamSubscription {
    return this.#bus.subscribe(afterEventId, mode);
  }

  /** Start the stream's first message or queue behind its active turn. */
  async deliver(message: SessionMessage): Promise<MessageDisposition> {
    if (this.#finished || this.#abortRequested) {
      throw new SessionStreamFinishedError();
    }

    if (!this.#hasOpenedTurn) {
      this.#hasOpenedTurn = true;
      await this.#startTurn(deferMessage(message));
      return "started";
    }

    const isSubmittingMessage = this.#sessionState.queuedMessages.some(
      ({ status }) => status === "submitting",
    );
    const queuedMessage =
      message.immediate && isSubmittingMessage ? deferMessage(message) : message;

    if (queuedMessage.immediate) {
      await this.#submitMessage(queuedMessage);
      return "queued";
    }

    const coalesceKey = coalesceKeyForMessage(queuedMessage);
    if (
      !coalesceKey ||
      !this.#sessionState.queuedMessages.some(
        (queued) => coalesceKeyForMessage(queued) === coalesceKey,
      )
    ) {
      this.#emit({
        type: "message_queued",
        message: queuedMessage,
      });
    }

    return "queued";
  }

  async steerQueuedMessage(clientId: string): Promise<boolean> {
    if (
      this.#abortRequested ||
      this.#sessionState.queuedMessages.some(({ status }) => status === "submitting")
    ) {
      return false;
    }

    const message = this.#sessionState.queuedMessages.find(
      (candidate) => candidate.clientId === clientId,
    );
    if (message?.role !== "user" || message.status !== "queued") {
      return false;
    }

    const immediateMessage: SessionMessage = { ...messageFromQueue(message), immediate: true };
    this.#emit({ type: "message_queued", message: immediateMessage });
    await this.#submitMessage(immediateMessage);
    return true;
  }

  cancelQueuedMessage(clientId: string): boolean {
    if (this.#finished) return false;

    const message = this.#sessionState.queuedMessages.find(
      (candidate) => candidate.clientId === clientId,
    );
    if (!message || message.status !== "queued") {
      return false;
    }

    this.#emit({
      type: "message_cancelled",
      clientId,
    });

    return true;
  }

  async answerQuestion({
    requestId,
    answer,
    wasFreeform,
  }: SessionQuestionAnswer): Promise<boolean> {
    if (
      this.#finished ||
      this.#abortRequested ||
      !hasPendingSessionQuestion(this.#sessionState, requestId)
    ) {
      return false;
    }

    return this.connection.answerQuestion({ requestId, answer, wasFreeform });
  }

  /** Wait for this stream instance to complete, not future replacements with the same ID. */
  waitForCompletion(timeoutMs?: number): Promise<SessionCompletion> {
    if (!this.#isCurrentStream()) {
      return Promise.resolve(
        this.#completionResult ?? completionResult(this.#sessionState.messages),
      );
    }

    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (status: SessionCompletion["status"] = "completed") => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.#completionWaiters.delete(finish);
        resolve(this.#completionResult ?? completionResult(this.#sessionState.messages, status));
      };

      this.#completionWaiters.add(finish);

      if (!this.#isCurrentStream()) {
        finish();
        return;
      }

      if (timeoutMs !== undefined && timeoutMs >= 0) {
        timer = setTimeout(() => finish("timed_out"), timeoutMs);
      }
    });
  }

  getSessionState(): SessionState {
    return this.#sessionState;
  }

  // ── Stream controls ──────────────────────────────────────────────────

  /** @internal Complete this execution; external controls should abort or delete the session. */
  finish(reason: StreamEndReason = "idle", error?: string): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#completionResult = completionResult(
      this.#sessionState.messages,
      reason === "error" ? "failed" : "completed",
    );

    this.#emit({ type: "end", reason, ...(error ? { error } : {}) });
    if (reason === "idle" && !this.#abortRequested) {
      cacheSnapshot(this.sessionId, this.#sessionState);
    }
    setSessionStatus(
      this.sessionId,
      this.#abortRequested || this.#bus.hasActiveSubscribers ? "idle" : "unread",
    );
    this.#bus.clearReplay();
    this.#dispose();
    releaseSession(this.sessionId);
  }

  /** Always finish the stream, even if the SDK abort itself fails. */
  async abort(): Promise<void> {
    this.#abortRequested = true;
    try {
      await this.connection.abort();
    } catch (error) {
      evictCachedSessionIfStale(this.sessionId, error);
      throw error;
    } finally {
      this.finish();
    }
  }

  // ── Turn execution ───────────────────────────────────────────────────

  async #startTurn(message: SessionMessage): Promise<void> {
    this.#bus.clearReplay();
    this.#sessionState = applySessionEvent(this.#sessionState, {
      type: "status",
      status: "thinking",
    });
    setSessionStatus(this.sessionId, "running");

    try {
      if (message.role === "user" && message.model) {
        await this.#setModel(message.model);
      }

      await this.connection.send(message);
    } catch (error) {
      evictCachedSessionIfStale(this.sessionId, error);
      this.finish("error");
      throw error;
    }
  }

  async #setModel(configuration: ModelConfiguration): Promise<void> {
    if (this.#finished) return;

    if (areModelConfigurationsEqual(configuration, this.#sessionState.model)) {
      return;
    }

    await this.connection.setModel(configuration);
    this.#emit({
      type: "model_changed",
      model: configuration,
    });
  }

  // ── Provider event handling ───────────────────────────────────────────────

  #handleProviderEvent(event: SessionEvent): void {
    if (event.type === "session_title_changed") {
      emitSessionNameUpdate(this.sessionId, event.title);
      return;
    }
    if (event.type === "end") {
      if (event.reason === "error") {
        if (!this.#abortRequested) this.finish("error", event.error);
      } else {
        void this.#drainMessageQueue();
      }
      return;
    }
    this.#emit(event);
  }

  async #drainMessageQueue(): Promise<void> {
    if (
      this.#abortRequested ||
      this.#sessionState.queuedMessages.some(({ status }) => status === "submitting")
    ) {
      return;
    }

    const queuedMessage = this.#sessionState.queuedMessages[0];
    if (!queuedMessage) {
      this.finish();
      return;
    }
    if (queuedMessage.status !== "queued") return;

    try {
      await this.#submitMessage(messageFromQueue(queuedMessage));
    } catch {
      // #startTurn already finished the stream; this runs from a floating SDK handler.
    }
  }

  // ── Event emission ───────────────────────────────────────────────────

  #emit(event: SessionEvent): void {
    const published = this.#bus.publish(event);
    const changesQuestionState =
      published.type === "question_requested" ||
      published.type === "question_resolved" ||
      published.type === "question_cancelled";
    const hadBlockingQuestion = changesQuestionState
      ? hasBlockingSessionQuestion(this.#sessionState)
      : false;
    this.#sessionState = applySessionEvent(this.#sessionState, published);
    const hasBlockingQuestion = changesQuestionState
      ? hasBlockingSessionQuestion(this.#sessionState)
      : false;
    if (changesQuestionState && hasBlockingQuestion !== hadBlockingQuestion) {
      setSessionStatus(this.sessionId, hasBlockingQuestion ? "waiting" : "running");
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  async #submitMessage(message: SessionMessage): Promise<void> {
    if (!this.#sessionState.queuedMessages.some(({ clientId }) => clientId === message.clientId)) {
      this.#emit({ type: "message_queued", message });
    }
    this.#emit({
      type: "message_status_changed",
      clientId: message.clientId,
      status: "submitting",
    });
    try {
      if (message.immediate) {
        await this.connection.send(message);
      } else {
        await this.#startTurn(message);
      }
      this.#emit({
        type: "message_status_changed",
        clientId: message.clientId,
        status: "submitted",
      });
    } catch (error) {
      if (
        message.immediate &&
        !this.#abortRequested &&
        this.#sessionState.queuedMessages.some(
          ({ clientId: candidateId }) => candidateId === message.clientId,
        )
      ) {
        this.#emit({
          type: "message_queued",
          message: deferMessage(message),
        });
      }
      throw error;
    }
  }

  updateArtifacts(paths: string[]): void {
    if (this.#finished) return;
    this.#emit({ type: "artifacts_changed", artifacts: paths });
  }

  #dispose(): void {
    // Session deletion can dispose without the domain finish transition. Mark
    // the stream finished so a stale reference cannot emit a terminal event or
    // accept a message after registry removal.
    this.#finished = true;

    this.#bus.close();
    for (const resolve of this.#completionWaiters) resolve();
    this.#completionWaiters.clear();
    this.#unsubscribeProvider();
    SessionStream.streams.delete(this.sessionId);
  }

  #isCurrentStream(): boolean {
    return SessionStream.get(this.sessionId) === this;
  }
}

export class SessionStreamFinishedError extends Error {
  constructor() {
    super("Session stream finished before the message could be delivered.");
  }
}

function coalesceKeyForMessage(message: SessionMessage): string | undefined {
  return message.role === "system" ? systemMessageCoalesceKey(message.content) : undefined;
}

function messageFromQueue(message: SessionState["queuedMessages"][number]): SessionMessage {
  const { status: _status, ...sessionMessage } = message;
  return sessionMessage;
}

function deferMessage(message: SessionMessage): SessionMessage {
  const { immediate: _immediate, ...deferred } = message;
  return deferred;
}

function completionResult(
  messages: SessionState["messages"],
  status: SessionCompletion["status"] = "completed",
): SessionCompletion {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "assistant" && message.content.trim().length > 0) {
      return { status, response: message.content };
    }
  }

  return { status };
}
