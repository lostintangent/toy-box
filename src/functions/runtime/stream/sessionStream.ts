// One live session runtime. A SessionStream owns an SDK session handle,
// reduced live state, queued turns, completion waiters, and a replayable event
// bus. It is the one live execution path shared by connected and headless
// delivery.
//
// Stamp ownership is deliberately split: the event bus stamps eventId for
// reconnect cursors, while the stream stamps turnId for turn-scoped reducer
// behavior such as duplicate-user-message detection.

import type { CopilotSession, SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";
import { encodeSdkAgentNotification } from "@/functions/sdk/agentNotificationCodec";
import { toSdkAttachments } from "@/functions/sdk/attachments";
import {
  createSdkEventProjector,
  getSdkSessionName,
  getSdkTurnEndReason,
} from "@/functions/sdk/projector";
import { evictCachedSessionIfStale } from "@/functions/state/session/registry";
import { cacheSnapshot, loadSessionSnapshot } from "@/functions/state/session/snapshots";
import { setSessionStatus } from "@/functions/state/workspace";
import { notificationCoalesceKey } from "@/lib/session/agentNotifications";
import { areModelConfigurationsEqual, toSdkSetModelOptions } from "@/lib/modelConfiguration";
import type { SessionSubscriptionMode } from "@/lib/session/protocol";
import {
  applySessionEvent,
  createInitialSession,
  prepareSessionForNextTurn,
  toSessionSnapshot,
  type Session,
} from "@/lib/session/sessionReducer";
import type { ModelConfiguration, QueuedMessage, SessionEvent } from "@/types";
import { emitSessionNameUpdate } from "../broadcast";
import { sharedMap } from "../processState";
import { createSessionEventBus, type SessionStreamSubscription } from "./eventBus";

export type SessionStreamCompletion = {
  status: "completed" | "failed" | "timed_out";
  response?: string;
};

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
// reconnectable"; terminal paths must close/detach so idle sessions disappear.
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
  ): Promise<SessionStreamCompletion> {
    const stream = SessionStream.get(sessionId);
    if (!stream) {
      return completionResult((await loadSessionSnapshot(sessionId)).messages);
    }
    return stream.waitForCompletion(timeoutMs);
  }

  /**
   * Publish a terminal event without idle/unread updates for a deleted session.
   * Deletion completes waiters cleanly.
   */
  static remove(sessionId: string): void {
    const stream = SessionStream.streams.get(sessionId);
    if (!stream) return;

    if (!stream.#closed) stream.#emit({ type: "end", reason: "idle" });
    stream.#shutdown();
  }

  // ── Instance fields ──────────────────────────────────────────────────

  readonly sessionId: string;
  private readonly sdkSession: CopilotSession;

  #bus = createSessionEventBus({
    capacity: MAX_REPLAY_EVENTS,
    onNoSubscribers: () => {
      if (this.#canDetach()) this.detach();
    },
  });

  readonly #completionWaiters = new Set<() => void>();

  // SDK event listener
  #unsubscribeSdk: () => void;

  // Live session state survives turn boundaries; only replay history is
  // turn-scoped.
  #sessionState: Session;
  #projectSdkEvent: ReturnType<typeof createSdkEventProjector>;

  // Event sequencing
  #currentTurnId: string | undefined;
  readonly #turnSeed = crypto.randomUUID();
  #nextTurnIndex = 0;
  #isDrainingQueue = false;
  // Claimed synchronously before #startTurn awaits so concurrent deliveries
  // cannot both open the stream's first turn.
  #hasOpenedTurn = false;
  #abortRequested = false;
  #closed = false;
  #shutdownComplete = false;
  #completionResult: SessionStreamCompletion | undefined;
  // Repeated delivery of one message ID returns its original decision instead
  // of starting or queueing it twice.
  readonly #dispositions = new Map<string, Promise<MessageDisposition>>();

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

  /** Deliver a message ID once, starting the stream or queueing behind it. */
  deliver(message: QueuedMessage): Promise<MessageDisposition> {
    const existing = this.#dispositions.get(message.id);
    if (existing) return existing;
    if (this.#closed) return Promise.reject(new SessionStreamClosedError());

    if (!this.#hasOpenedTurn) {
      this.#hasOpenedTurn = true;
      const disposition = this.#startTurn(message, turnOpeningEvent(message)).then(
        () => "started" as const,
      );
      this.#dispositions.set(message.id, disposition);
      return disposition;
    }

    const disposition = Promise.resolve("queued" as const);
    this.#dispositions.set(message.id, disposition);

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

    return disposition;
  }

  cancelQueuedMessage(queuedMessageId: string): boolean {
    if (this.#closed) return false;

    const index = this.#sessionState.queuedMessages.findIndex((m) => m.id === queuedMessageId);
    if (index === -1) return false;

    this.#emit({
      type: "message_cancelled",
      queuedMessageId,
    });

    return true;
  }

  /** Wait for this stream instance to complete, not future replacements with the same ID. */
  waitForCompletion(timeoutMs?: number): Promise<SessionStreamCompletion> {
    if (!this.#isCurrentStream()) {
      return Promise.resolve(
        this.#completionResult ?? completionResult(this.#sessionState.messages),
      );
    }

    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (status: SessionStreamCompletion["status"] = "completed") => {
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

  /** @internal Terminal lifecycle transition; external controls should abort or delete. */
  close(reason: StreamEndReason = "idle"): void {
    if (this.#closed) return;
    this.#closed = true;
    // Capture completion before publishing end/error; the reducer can replace
    // the session state's trailing assistant message for terminal rendering.
    this.#completionResult = completionResult(
      this.#sessionState.messages,
      reason === "error" ? "failed" : "completed",
    );

    this.#emit({ type: "end", reason });
    setSessionStatus(
      this.sessionId,
      this.#abortRequested || this.#bus.hasActiveSubscribers ? "idle" : "unread",
    );
    this.#bus.clearReplay();
    this.#shutdown();
  }

  /** Always close the stream, even if the SDK abort itself fails. */
  async abort(): Promise<void> {
    this.#abortRequested = true;
    try {
      await this.sdkSession.abort();
    } catch (error) {
      evictCachedSessionIfStale(this.sessionId, error);
      throw error;
    } finally {
      this.close();
    }
  }

  /** @internal Registry detachment; production teardown should close or remove. */
  detach(): void {
    this.#resolveCompletionWaiters();
    this.#unsubscribeSdk();
    SessionStream.streams.delete(this.sessionId);
  }

  // ── Turn execution ───────────────────────────────────────────────────

  async #startTurn(message: QueuedMessage, openingEvent: SessionEvent): Promise<void> {
    this.#prepareForNewTurn();
    this.#emit(openingEvent);

    try {
      const model = message.role === "user" ? message.model : undefined;
      if (model) {
        await this.#setModel(model);
      }

      await this.sdkSession.send({
        prompt:
          message.role === "agent_notification"
            ? encodeSdkAgentNotification(message.notification)
            : message.content,
        attachments: toSdkAttachments(message.role === "user" ? message.attachments : undefined),
      });
    } catch (error) {
      evictCachedSessionIfStale(this.sessionId, error);
      this.close("error");
      throw error;
    }
  }

  #prepareForNewTurn(): void {
    this.#bus.clearReplay();

    this.#currentTurnId = this.#generateTurnId();
    this.#sessionState = prepareSessionForNextTurn(this.#sessionState);

    setSessionStatus(this.sessionId, "running");
  }

  async #setModel(configuration: ModelConfiguration): Promise<void> {
    if (this.#closed) return;

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
        this.close("error");
        return;
      }
      void this.#drainMessageQueue();
      return;
    }

    const projectedEvents = this.#projectSdkEvent(sdkEvent);
    for (const sessionEvent of projectedEvents) {
      this.#emit(sessionEvent, sdkEvent.type);
    }
  }

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

      await this.#startTurn(queuedMessage, {
        type: "message_dequeued",
        message: queuedMessage,
      });
    } catch {
      // #startTurn already closed the stream; this runs from a floating SDK handler.
    } finally {
      this.#isDrainingQueue = false;
    }
  }

  // ── Event emission ───────────────────────────────────────────────────

  #emit(event: SessionEvent, sourceEventType?: string): void {
    const published = this.#bus.publish(this.#decorateTurn(event, sourceEventType));
    this.#sessionState = applySessionEvent(this.#sessionState, published);
  }

  #decorateTurn(event: SessionEvent, sourceEventType?: string): SessionEvent {
    if (sourceEventType === "assistant.turn_start") {
      // The SDK can emit multiple agent-loop turn starts for one sent prompt.
      // Keep those segments distinct for downstream echo dedupe.
      this.#currentTurnId = this.#generateTurnId();
    } else if (!this.#currentTurnId) {
      // Events arriving before any turn boundary (e.g. attaching to a
      // resumed session mid-turn) share a stable bootstrap turn id.
      this.#currentTurnId = `${this.sessionId}:turn:bootstrap`;
    }
    return { ...event, turnId: this.#currentTurnId };
  }

  #generateTurnId(): string {
    return `${this.sessionId}:turn:${this.#turnSeed}:${this.#nextTurnIndex++}`;
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  /** Cache the clean-close snapshot; abort/error closes may hold unpersisted content. */
  #cacheFinalSnapshot(): void {
    // close() publishes the canonical end event after this. Pre-applying it
    // here captures finalized idle state before global idle updates can refetch.
    this.#sessionState = applySessionEvent(this.#sessionState, { type: "end", reason: "idle" });
    cacheSnapshot(this.sessionId, toSessionSnapshot(this.sessionId, this.#sessionState));
  }

  #shutdown(): void {
    if (this.#shutdownComplete) return;
    this.#shutdownComplete = true;
    // remove/delete teardown reaches #shutdown directly. Mark the stream
    // closed so a later close() cannot publish an end event retroactively.
    this.#closed = true;

    this.#sessionState = { ...this.#sessionState, queuedMessages: [] };
    this.#bus.close();
    this.detach();
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

  #canDetach(): boolean {
    return (
      !this.#bus.hasSubscribers &&
      !this.#isDrainingQueue &&
      this.#sessionState.queuedMessages.length === 0 &&
      !this.#bus.hasReplayEvents
    );
  }
}

export class SessionStreamClosedError extends Error {
  constructor() {
    super("Session stream closed before the message could be delivered.");
  }
}

function coalesceKeyForMessage(message: QueuedMessage): string | undefined {
  return message.role === "agent_notification"
    ? notificationCoalesceKey(message.notification)
    : undefined;
}

function turnOpeningEvent(message: QueuedMessage): SessionEvent {
  if (message.role === "agent_notification") {
    return { type: "agent_notification", notification: message.notification };
  }

  return {
    type: "user_message",
    content: message.content,
    attachments: message.attachments,
    clientMessageId: message.id,
  };
}

function completionResult(
  messages: Session["messages"],
  status: SessionStreamCompletion["status"] = "completed",
): SessionStreamCompletion {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "assistant" && message.content.trim().length > 0) {
      return { status, response: message.content };
    }
  }

  return { status };
}
