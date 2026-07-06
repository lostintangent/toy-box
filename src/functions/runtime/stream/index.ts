// Session streaming runtime. Edges say "send"; this module delivers messages
// into live streams. A stream owns one active SDK session handle, reduced live
// state, queued turns, completion waiters, and a stream buffer for replay +
// fan-out.
//
// Stamp ownership is deliberately split: the stream buffer stamps eventId for
// reconnect cursors, while the stream stamps turnId for turn-scoped reducer
// behavior such as duplicate-user-message detection.

import type {
  CopilotSession,
  SessionContext,
  SessionEvent as SdkSessionEvent,
} from "@github/copilot-sdk";
import { createSession, evictCachedSessionIfStale, getSession } from "../../state/sessionRegistry";
import { markSessionUnread, markSessionRead } from "../../state/workspace";
import { notificationCoalesceKey } from "@/lib/session/agentNotifications";
import { encodeSdkAgentNotification } from "@/functions/sdk/agentNotificationCodec";
import { emitSessionRunning, emitSessionIdle, updateSessionName } from "../broadcast";
import {
  applySessionEvent,
  createInitialSession,
  prepareSessionForNextTurn,
  sessionSeedFromSnapshot,
  toSessionSnapshot,
} from "@/lib/session/sessionReducer";
import { cacheSnapshot, loadSessionSnapshot } from "../../state/snapshotCache";
import {
  createProjectionState,
  getSdkMetadataPatch,
  getSdkStreamTerminalDisposition,
  projectSdkEvent,
} from "@/functions/sdk/projector";
import { toSdkAttachmentBlobs } from "@/functions/sdk/attachments";
import type { Attachment, ModelConfiguration, QueuedMessage, SessionEvent } from "@/types";
import type { Session } from "@/lib/session/sessionReducer";
import { areModelConfigurationsEqual, toSdkSetModelOptions } from "@/lib/modelConfiguration";
import { sharedMap } from "../processState";
import { createSessionStreamBuffer } from "./buffer";
import type { SessionStreamSubscription } from "./buffer";

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
  onDelivered?: () => void;
};

export type SessionCompletionResult = {
  response?: string;
  error?: string;
};

export type DeliveryCreateOptions = {
  directory?: string;
  useWorktree?: boolean;
  parentSessionId?: string;
  initialContext?: SessionContext;
  automationId?: string;
  summary?: string;
};

/**
 * Internal delivery request. Creation metadata lives in `create`; model
 * configuration travels on the delivered message so every path uses the same
 * model-change event semantics.
 */
export type DeliverSessionMessageOptions = {
  sessionId: string;
  message: QueuedMessage;
  create?: DeliveryCreateOptions;
  onDelivered?: () => void;
};

export type DeliveryReceipt = {
  sessionId: string;
  disposition: "sent" | "queued";
  /** Resolves when the delivered message's stream instance completes. */
  completion(): Promise<SessionCompletionResult>;
};

type StreamEndReason = Extract<SessionEvent, { type: "end" }>["reason"];

// Replay retention cap. A client reconnecting across a gap larger than this
// silently misses the trimmed events; the client heals by refetching the
// detail snapshot when its stream completes (see useSession), so the cap
// trades a rare extra refetch for bounded memory.
const MAX_REPLAY_EVENTS = 1500;
const SESSION_FAILED_ERROR = "The session ended with an error.";
const SESSION_TIMEOUT_ERROR = "Timed out waiting for the session to complete.";

// ============================================================================
// Public Entry Points
// ============================================================================

/** Open the client-facing stream, optionally starting a prompt turn. */
export async function* connectClientStream(
  options: SessionStreamConfig,
): AsyncGenerator<SessionEvent> {
  if (!options.prompt) {
    const stream = SessionStream.get(options.sessionId);
    if (stream) yield* stream.subscribe(options.afterEventId);
    return;
  }

  const messageOptions: DeliverSessionMessageOptions = {
    sessionId: options.sessionId,
    message: {
      id: options.clientMessageId ?? crypto.randomUUID(),
      role: "user",
      content: options.prompt,
      attachments: options.attachments,
      modelConfiguration: options.modelConfiguration,
    },
    create: options.startNew
      ? {
          directory: options.directory,
          useWorktree: options.useWorktree,
        }
      : undefined,
    onDelivered: options.onDelivered,
  };

  let retriedClosedQueue = false;

  for (;;) {
    const { stream, created } = await acquireSessionStream(messageOptions);
    if (!created) {
      if (!options.startNew) {
        try {
          queueMessage(stream, messageOptions.message);
          options.onDelivered?.();
          return;
        } catch (error) {
          if (error instanceof StreamClosedBeforeQueueError && !retriedClosedQueue) {
            retriedClosedQueue = true;
            continue;
          }

          throw error;
        }
      }

      // Stale draft retry: the original turn already exists, so attach to it
      // instead of sending or queueing a duplicate prompt.
      yield* stream.subscribe(options.afterEventId);
      return;
    }

    yield* streamMessageTurn(stream, messageOptions);
    return;
  }
}

/** Deliver a message into a session's turn sequence, starting or queueing as needed. */
export async function deliverSessionMessage(
  options: DeliverSessionMessageOptions,
): Promise<DeliveryReceipt> {
  return deliverSessionMessageWithRetry(options);
}

async function deliverSessionMessageWithRetry(
  options: DeliverSessionMessageOptions,
): Promise<DeliveryReceipt> {
  let retriedClosedQueue = false;
  let retriedStaleHandle = false;

  for (;;) {
    try {
      return await deliverSessionMessageOnce(options);
    } catch (error) {
      if (error instanceof StreamClosedBeforeQueueError && !retriedClosedQueue) {
        retriedClosedQueue = true;
        continue;
      }

      // A stale cached SDK handle (possible on the snapshot-seed path, which
      // skips the replay path's getEvents probe) surfaces as a send failure
      // after startTurn's catch evicted it and closed the stream. Delivery has
      // no user to retry, so rebuild once — the resume is fresh by construction
      // and the cached snapshot is still valid (the log never changed).
      if (!retriedStaleHandle && evictCachedSessionIfStale(options.sessionId, error)) {
        retriedStaleHandle = true;
        continue;
      }

      throw error;
    }
  }
}

async function deliverSessionMessageOnce(
  options: DeliverSessionMessageOptions,
): Promise<DeliveryReceipt> {
  const { stream, created } = await acquireSessionStream(options);
  if (!created) {
    // A create request against a live stream is a stale draft retry: the
    // original delivery already opened the turn, so do not queue a duplicate.
    if (options.create) {
      return deliveryReceipt(stream, "sent");
    }

    queueMessage(stream, options.message);
    return deliveryReceipt(stream, "queued");
  }

  await stream.startTurn(options.message);
  return deliveryReceipt(stream, "sent");
}

// Covers the delivery acquisition window before the stream reaches the registry.
const pendingStreamCreations = sharedMap<Promise<SessionStream>>("pending-session-streams");

type StreamAcquisition = {
  stream: SessionStream;
  created: boolean;
};

/** Single-flight get-or-create; only the creator starts the opening turn. */
async function acquireSessionStream(
  options: DeliverSessionMessageOptions,
): Promise<StreamAcquisition> {
  const existing = SessionStream.get(options.sessionId);
  if (existing) return { stream: existing, created: false };

  const pending = pendingStreamCreations.get(options.sessionId);
  if (pending) return { stream: await pending, created: false };

  const creation = createStreamForDelivery(options).finally(() => {
    pendingStreamCreations.delete(options.sessionId);
  });
  pendingStreamCreations.set(options.sessionId, creation);
  return { stream: await creation, created: true };
}

async function createStreamForDelivery(
  options: DeliverSessionMessageOptions,
): Promise<SessionStream> {
  if (options.create) {
    const sdkSession = await createSession(options.sessionId, {
      modelConfiguration: modelConfigurationForMessage(options.message),
      directory: options.create.directory,
      useWorktree: options.create.useWorktree,
      parentSessionId: options.create.parentSessionId,
      initialContext: options.create.initialContext,
      automationId: options.create.automationId,
    });
    if (options.create.summary) {
      updateSessionName(options.sessionId, options.create.summary);
    }
    return SessionStream.getOrCreate(options.sessionId, sdkSession, {
      modelConfiguration: modelConfigurationForMessage(options.message),
    });
  }

  const snapshot = await loadSessionSnapshot(options.sessionId);
  const sdkSession = await getSession(options.sessionId);
  return SessionStream.getOrCreate(
    options.sessionId,
    sdkSession,
    sessionSeedFromSnapshot(snapshot),
  );
}

function deliveryReceipt(
  stream: SessionStream,
  disposition: DeliveryReceipt["disposition"],
): DeliveryReceipt {
  return {
    sessionId: stream.sessionId,
    disposition,
    completion: () => stream.waitForCompletion(),
  };
}

async function* streamMessageTurn(
  stream: SessionStream,
  options: DeliverSessionMessageOptions,
): AsyncGenerator<SessionEvent> {
  // `subscribe()` registers eagerly; the first turn can emit and close before
  // this generator starts pulling.
  const events = stream.subscribe();
  // startTurn failures are published as end/error; this guard only prevents
  // an unhandled rejection when the client has already cancelled.
  void stream
    .startTurn(options.message)
    .then(() => {
      options.onDelivered?.();
    })
    .catch(() => {});
  yield* events;
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
  // ── Static registry and controls ─────────────────────────────────────

  private static readonly streams = sessionStreams;

  static get(sessionId: string): SessionStream | undefined {
    return SessionStream.streams.get(sessionId);
  }

  /** @internal Delivery acquisition is the production stream-creation path. */
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

  static getRunningSessionIds(): string[] {
    return Array.from(SessionStream.streams.keys());
  }

  static isRunning(sessionId: string): boolean {
    return SessionStream.streams.has(sessionId);
  }

  static async waitForCompletion(
    sessionId: string,
    timeoutMs?: number,
  ): Promise<SessionCompletionResult> {
    const stream = SessionStream.get(sessionId);
    if (!stream) {
      return completionResult((await loadSessionSnapshot(sessionId)).messages);
    }
    return stream.waitForCompletion(timeoutMs);
  }

  static close(sessionId: string): void {
    SessionStream.streams.get(sessionId)?.close();
  }

  /**
   * Deletion teardown: give subscribers a terminal event without emitting
   * idle/unread global broadcast events for a session that is leaving the list.
   *
   * Deletion resolves pending waiters as a clean completion; the deleting
   * parent is the only waiter in normal tool-driven flows, so no error
   * disposition is set here.
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

  #streamBuffer = createSessionStreamBuffer({
    capacity: MAX_REPLAY_EVENTS,
    onNoSubscribers: () => {
      if (this.#isIdle()) this.detach();
    },
  });

  readonly #completionWaiters = new Set<() => void>();

  // SDK event listener
  #unsubscribeSdk: () => void;

  // Live session state survives turn boundaries; only replay history is
  // turn-scoped.
  #sessionState: Session;
  #projectionState: ReturnType<typeof createProjectionState>;

  // Event sequencing
  #currentTurnId: string | undefined;
  readonly #turnSeed = crypto.randomUUID();
  #nextTurnIndex = 0;
  #isDrainingQueue = false;
  #closed = false;
  #shutdownComplete = false;
  #completionResult: SessionCompletionResult | undefined;

  private constructor(
    sessionId: string,
    sdkSession: CopilotSession,
    initialState?: Partial<Session>,
  ) {
    this.sessionId = sessionId;
    this.sdkSession = sdkSession;
    this.#sessionState = createInitialSession(initialState);
    this.#projectionState = createProjectionState(sessionId);
    this.#unsubscribeSdk = sdkSession.on((event) => this.#handleSdkEvent(event));
  }

  // ── Live stream surface ──────────────────────────────────────────────

  subscribe(afterEventId?: number): SessionStreamSubscription {
    return this.#streamBuffer.subscribe(afterEventId);
  }

  /** @internal Test seam for stream/buffer cursor behavior. */
  getReplayEventsSince(afterEventId?: number): SessionEvent[] {
    return this.#streamBuffer.replaySince(afterEventId);
  }

  getSessionState(): Session {
    return this.#sessionState;
  }

  getQueuedMessages(): QueuedMessage[] {
    return this.#sessionState.queuedMessages;
  }

  /** Queue a message for the next turn, coalescing equivalent notifications. */
  addQueuedMessage(message: QueuedMessage): boolean {
    if (this.#closed) return false;

    const coalesceKey = coalesceKeyForMessage(message);
    if (
      coalesceKey &&
      this.#sessionState.queuedMessages.some(
        (queued) => coalesceKeyForMessage(queued) === coalesceKey,
      )
    ) {
      return true;
    }

    this.#emit({
      type: "message_queued",
      message,
    });

    return true;
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

  /** @internal Delivery is the production turn-start path. */
  async startTurn(message: QueuedMessage): Promise<void> {
    await this.#startTurn(message, turnOpeningEvent(message));
  }

  /** Wait for this stream instance to complete, not future replacements with the same ID. */
  waitForCompletion(timeoutMs?: number): Promise<SessionCompletionResult> {
    if (!this.#isCurrentStream()) {
      return Promise.resolve(
        this.#completionResult ?? completionResult(this.#sessionState.messages),
      );
    }

    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (error?: string) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.#completionWaiters.delete(finish);
        resolve(this.#completionResult ?? completionResult(this.#sessionState.messages, error));
      };

      this.#completionWaiters.add(finish);

      if (!this.#isCurrentStream()) {
        finish();
        return;
      }

      if (timeoutMs !== undefined && timeoutMs >= 0) {
        timer = setTimeout(() => finish(SESSION_TIMEOUT_ERROR), timeoutMs);
      }
    });
  }

  // ── Stream controls ──────────────────────────────────────────────────

  // close = terminal event + #finishStream + #shutdown; remove skips #finishStream.
  close(reason: StreamEndReason = "idle"): void {
    if (this.#closed) return;
    this.#closed = true;
    // Capture completion before publishing end/error; the reducer can replace
    // the session state's trailing assistant message for terminal rendering.
    this.#completionResult = completionResult(
      this.#sessionState.messages,
      reason === "error" ? SESSION_FAILED_ERROR : undefined,
    );

    this.#emit({ type: "end", reason });
    this.#finishStream();
    this.#shutdown();
  }

  /** Always close the stream, even if the SDK abort itself fails. */
  async abort(): Promise<void> {
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

  async #startQueuedTurn(message: QueuedMessage): Promise<void> {
    await this.#startTurn(message, queuedTurnOpeningEvent(message));
  }

  async #startTurn(message: QueuedMessage, openingEvent: SessionEvent): Promise<void> {
    this.#prepareForNewTurn();
    this.#emit(openingEvent);

    try {
      const modelConfiguration = modelConfigurationForMessage(message);
      if (modelConfiguration?.model) {
        await this.#setModel(modelConfiguration);
      }

      await this.sdkSession.send({
        prompt: sdkPromptForMessage(message),
        attachments: toSdkAttachmentBlobs(attachmentsForMessage(message)),
      });
    } catch (error) {
      evictCachedSessionIfStale(this.sessionId, error);
      this.close("error");
      throw error;
    }
  }

  #prepareForNewTurn(): void {
    this.#streamBuffer.clearReplay();

    this.#currentTurnId = this.#generateTurnId();
    prepareSessionForNextTurn(this.#sessionState);

    emitSessionRunning(this.sessionId);
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

      await this.#startQueuedTurn(queuedMessage);
    } catch {
      // #startTurn already closed the stream; this runs from a floating SDK handler.
    } finally {
      this.#isDrainingQueue = false;
    }
  }

  // ── SDK event handling ───────────────────────────────────────────────

  #handleSdkEvent(sdkEvent: SdkSessionEvent): void {
    const metadataPatch = getSdkMetadataPatch(sdkEvent);
    if (metadataPatch) {
      updateSessionName(this.sessionId, metadataPatch.summary);
    }

    const streamTerminal = getSdkStreamTerminalDisposition(sdkEvent.type);
    if (streamTerminal) {
      if (streamTerminal === "error") {
        this.close("error");
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

  // ── Event emission ───────────────────────────────────────────────────

  #emit(event: SessionEvent, sourceEventType?: string): void {
    const eventWithTurn = this.#decorateTurn(event, sourceEventType);
    const decorated = this.#streamBuffer.publish(eventWithTurn);

    applySessionEvent(this.#sessionState, decorated);
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
    applySessionEvent(this.#sessionState, { type: "end", reason: "idle" });
    cacheSnapshot(this.sessionId, toSessionSnapshot(this.sessionId, this.#sessionState));
  }

  #finishStream(): void {
    this.#updateUnreadOnStreamEnd();
    this.#streamBuffer.clearReplay();
    emitSessionIdle(this.sessionId);
  }

  #shutdown(): void {
    if (this.#shutdownComplete) return;
    this.#shutdownComplete = true;
    // remove/delete teardown reaches #shutdown directly. Mark the stream
    // closed so a later close() cannot publish an end event retroactively.
    this.#closed = true;

    this.#sessionState.queuedMessages.length = 0;
    this.#streamBuffer.close();
    this.detach();
  }

  async #setModel(configuration: ModelConfiguration): Promise<void> {
    if (this.#closed) return;
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

  #updateUnreadOnStreamEnd(): void {
    if (this.#streamBuffer.hasSubscribers) {
      markSessionRead(this.sessionId);
    } else {
      markSessionUnread(this.sessionId);
    }
  }

  #isIdle(): boolean {
    return (
      !this.#streamBuffer.hasSubscribers &&
      !this.#isDrainingQueue &&
      this.#sessionState.queuedMessages.length === 0 &&
      this.#streamBuffer.bufferedCount === 0
    );
  }
}

// ============================================================================
// Local Helpers
// ============================================================================

function queueMessage(stream: SessionStream, message: QueuedMessage): void {
  if (!stream.addQueuedMessage(message)) {
    throw new StreamClosedBeforeQueueError();
  }
}

class StreamClosedBeforeQueueError extends Error {
  constructor() {
    super("Session stream closed before the message could be queued.");
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

function queuedTurnOpeningEvent(message: QueuedMessage): SessionEvent {
  return { type: "message_dequeued", message };
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

function completionResult(messages: Session["messages"], error?: string): SessionCompletionResult {
  const response = getLastAssistantResponse(messages);
  return {
    ...(response ? { response } : {}),
    ...(error ? { error } : {}),
  };
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
