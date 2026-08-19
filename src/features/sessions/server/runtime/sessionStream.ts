// One live session runtime. A SessionStream owns an SDK session handle,
// reduced live state, queued turns, completion waiters, and a replayable event
// bus. It is the one live execution path shared by connected and headless
// delivery.
//
// The event bus stamps eventId for reconnect cursors. Client-provided message
// identity is correlated separately when the SDK echoes sent inputs.

import type { CopilotSession, SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";
import { encodeSdkAgentNotification } from "@sessions/server/sdk/agentNotificationCodec";
import { toSdkAttachments } from "@sessions/server/sdk/attachments";
import {
  createSdkEventProjector,
  getSdkSessionName,
  getSdkTurnEndReason,
} from "@sessions/server/sdk/projector";
import { evictCachedSessionIfStale } from "@sessions/server/state/registry";
import { cacheSnapshot, loadSessionSnapshot } from "@sessions/server/state/snapshots";
import { setSessionStatus } from "@workspace/server/state";
import { notificationCoalesceKey } from "@sessions/model/agentNotifications";
import {
  areModelConfigurationsEqual,
  toSdkSetModelOptions,
} from "@sessions/model/modelConfiguration";
import type { SessionSubscriptionMode } from "@sessions/model/protocol";
import {
  applySessionEvent,
  createInitialSession,
  prepareSessionForNextTurn,
  toSessionSnapshot,
  type Session,
} from "@sessions/model/reducer";
import type { QueuedMessage, SessionCompletion, SessionEvent } from "@sessions/model";
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
  /** Underlying SDK handle used by runtime-owned session operations. */
  readonly sdkSession: CopilotSession;

  #bus = createSessionEventBus(MAX_REPLAY_EVENTS);

  readonly #completionWaiters = new Set<() => void>();

  // SDK event listener
  #unsubscribeSdk: () => void;

  // Live session state survives turn boundaries; only replay history is
  // turn-scoped.
  #sessionState: Session;
  #projectSdkEvent: ReturnType<typeof createSdkEventProjector>;

  /** Toy Box client IDs awaiting their corresponding SDK user.message events.
   *  Remove when the SDK accepts caller-provided message IDs. */
  readonly #pendingClientIds: string[] = [];
  #isSendingQueuedMessage = false;
  // Claimed synchronously before #startTurn awaits so concurrent deliveries
  // cannot both open the stream's first turn.
  #hasOpenedTurn = false;
  #abortRequested = false;
  #finished = false;
  #disposed = false;
  #completionResult: SessionCompletion | undefined;

  private constructor(
    sessionId: string,
    sdkSession: CopilotSession,
    initialState?: Partial<Session>,
  ) {
    this.sessionId = sessionId;
    this.sdkSession = sdkSession;
    this.#sessionState = createInitialSession(initialState);
    this.#projectSdkEvent = createSdkEventProjector(sessionId);

    this.#unsubscribeSdk = sdkSession.on((event) => this.#handleSdkEvent(event));
  }

  // ── Live stream surface ──────────────────────────────────────────────

  subscribe(
    afterEventId?: number,
    mode: SessionSubscriptionMode = "active",
  ): SessionStreamSubscription {
    return this.#bus.subscribe(afterEventId, mode);
  }

  /** Start the stream's first message or queue behind its active turn. */
  async deliver(message: QueuedMessage): Promise<MessageDisposition> {
    if (this.#finished || this.#abortRequested) {
      throw new SessionStreamFinishedError();
    }

    if (!this.#hasOpenedTurn) {
      this.#hasOpenedTurn = true;
      await this.#startTurn(message);
      return "started";
    }

    const coalesceKey = coalesceKeyForMessage(message);
    if (
      !coalesceKey ||
      !this.#sessionState.queuedMessages.some(
        (queued) => coalesceKeyForMessage(queued) === coalesceKey,
      )
    ) {
      this.#emit({
        type: "message_queued",
        message,
      });
    }

    return "queued";
  }

  async steerQueuedMessage(clientId: string): Promise<boolean> {
    if (this.#abortRequested || this.#isSendingQueuedMessage) {
      return false;
    }

    const message = this.#sessionState.queuedMessages.find(
      (candidate) => candidate.clientId === clientId,
    );
    if (
      message?.role !== "user" ||
      message.isSteering ||
      this.#pendingClientIds.includes(clientId)
    ) {
      return false;
    }

    this.#isSendingQueuedMessage = true;
    this.#emit({
      type: "message_queued",
      message: { ...message, isSteering: true },
    });

    try {
      await this.#sendToSdk(message, "immediate");
      return true;
    } catch (error) {
      if (
        !this.#abortRequested &&
        this.#sessionState.queuedMessages.some(
          ({ clientId: candidateId }) => candidateId === message.clientId,
        )
      ) {
        this.#emit({ type: "message_queued", message });
      }
      throw error;
    } finally {
      this.#isSendingQueuedMessage = false;
    }
  }

  cancelQueuedMessage(clientId: string): boolean {
    if (this.#finished) return false;

    const message = this.#sessionState.queuedMessages.find(
      (candidate) => candidate.clientId === clientId,
    );
    if (
      !message ||
      this.#pendingClientIds.includes(clientId) ||
      (message.role === "user" && message.isSteering)
    ) {
      return false;
    }

    this.#emit({
      type: "message_cancelled",
      clientId,
    });

    return true;
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

  getSessionState(): Session {
    return this.#sessionState;
  }

  getQueuedMessages(): QueuedMessage[] {
    return this.#sessionState.queuedMessages;
  }

  /** @internal Test seam for event replay cursor behavior. */
  getReplayEventsSince(afterEventId?: number): SessionEvent[] {
    return this.#bus.replaySince(afterEventId);
  }

  // ── Stream controls ──────────────────────────────────────────────────

  /** @internal Complete this execution; external controls should abort or delete the session. */
  finish(reason: StreamEndReason = "idle"): void {
    if (this.#finished) return;
    this.#finished = true;
    // Capture completion before publishing end/error; the reducer can replace
    // the session state's trailing assistant message for terminal rendering.
    this.#completionResult = completionResult(
      this.#sessionState.messages,
      reason === "error" ? "failed" : "completed",
    );

    this.#emit({ type: "end", reason });
    if (reason === "idle" && !this.#abortRequested) {
      cacheSnapshot(this.sessionId, toSessionSnapshot(this.sessionId, this.#sessionState));
    }
    setSessionStatus(
      this.sessionId,
      this.#abortRequested || this.#bus.hasActiveSubscribers ? "idle" : "unread",
    );
    this.#bus.clearReplay();
    this.#dispose();
  }

  /** Always finish the stream, even if the SDK abort itself fails. */
  async abort(): Promise<void> {
    this.#abortRequested = true;
    try {
      try {
        await this.sdkSession.rpc.queue.clear();
      } finally {
        await this.sdkSession.abort();
      }
    } catch (error) {
      evictCachedSessionIfStale(this.sessionId, error);
      throw error;
    } finally {
      this.finish();
    }
  }

  // ── Turn execution ───────────────────────────────────────────────────

  async #startTurn(message: QueuedMessage): Promise<void> {
    this.#prepareForNewTurn();

    try {
      const model = message.role === "user" ? message.model : undefined;
      if (model) {
        await this.#setModel(model);
      }

      await this.#sendToSdk(message);
    } catch (error) {
      evictCachedSessionIfStale(this.sessionId, error);
      this.finish("error");
      throw error;
    }
  }

  #prepareForNewTurn(): void {
    this.#bus.clearReplay();

    this.#sessionState = prepareSessionForNextTurn(this.#sessionState);

    setSessionStatus(this.sessionId, "running");
  }

  async #setModel(configuration: ModelConfiguration): Promise<void> {
    if (this.#finished) return;

    if (areModelConfigurationsEqual(configuration, this.#sessionState.model)) {
      return;
    }

    await this.sdkSession.setModel(configuration.name, toSdkSetModelOptions(configuration));
    this.#emit({
      type: "model_changed",
      model: configuration,
    });
  }

  // ── SDK event handling ───────────────────────────────────────────────

  #handleSdkEvent(sdkEvent: SdkSessionEvent): void {
    const sessionName = getSdkSessionName(sdkEvent);
    if (sessionName) {
      emitSessionNameUpdate(this.sessionId, sessionName);
    }

    const turnEndReason = getSdkTurnEndReason(sdkEvent);
    if (turnEndReason) {
      if (turnEndReason === "error") {
        if (this.#abortRequested) return;
        this.finish("error");
        return;
      }
      void this.#drainMessageQueue();
      return;
    }

    const projectedEvents = this.#projectSdkEvent(sdkEvent);
    for (const sessionEvent of projectedEvents) {
      this.#emit(this.#correlateInputEvent(sessionEvent));
    }
  }

  async #drainMessageQueue(): Promise<void> {
    if (this.#abortRequested || this.#isSendingQueuedMessage) return;

    const queuedMessage = this.#sessionState.queuedMessages[0];
    if (!queuedMessage) {
      this.finish();
      return;
    }
    if (queuedMessage.role === "user" && queuedMessage.isSteering) return;

    this.#isSendingQueuedMessage = true;

    try {
      await this.#startTurn(queuedMessage);
    } catch {
      // #startTurn already finished the stream; this runs from a floating SDK handler.
    } finally {
      this.#isSendingQueuedMessage = false;
    }
  }

  // ── Event emission ───────────────────────────────────────────────────

  #emit(event: SessionEvent): void {
    const published = this.#bus.publish(event);
    this.#sessionState = applySessionEvent(this.#sessionState, published);
  }

  #correlateInputEvent(event: SessionEvent): SessionEvent {
    if (event.type !== "user_message" && event.type !== "agent_notification") return event;
    const clientId = this.#pendingClientIds.shift();
    return clientId ? { ...event, clientId } : event;
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  async #sendToSdk(message: QueuedMessage, mode?: "immediate"): Promise<void> {
    this.#pendingClientIds.push(message.clientId);
    try {
      await this.sdkSession.send({
        prompt:
          message.role === "agent_notification"
            ? encodeSdkAgentNotification(message.notification)
            : message.content,
        attachments: toSdkAttachments(message.role === "user" ? message.attachments : undefined),
        ...(mode ? { mode } : {}),
      });
    } catch (error) {
      const index = this.#pendingClientIds.indexOf(message.clientId);
      if (index !== -1) this.#pendingClientIds.splice(index, 1);
      throw error;
    }
  }

  #dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    // Session deletion can dispose without the domain finish transition. Mark
    // the stream finished so a stale reference cannot emit a terminal event or
    // accept a message after registry removal.
    this.#finished = true;

    this.#sessionState = { ...this.#sessionState, queuedMessages: [] };
    this.#bus.close();
    this.#resolveCompletionWaiters();
    this.#unsubscribeSdk();
    SessionStream.streams.delete(this.sessionId);
  }

  #resolveCompletionWaiters(): void {
    if (this.#completionWaiters.size === 0) return;
    for (const resolve of this.#completionWaiters) {
      resolve();
    }
    this.#completionWaiters.clear();
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

function coalesceKeyForMessage(message: QueuedMessage): string | undefined {
  return message.role === "agent_notification"
    ? notificationCoalesceKey(message.notification)
    : undefined;
}

function completionResult(
  messages: Session["messages"],
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
