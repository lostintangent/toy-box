// One live session runtime. A SessionExecution owns a provider connection,
// reduced live state, queued turns, completion waiters, and a replayable event
// log. It is the one live execution path shared by connected and headless
// delivery.
//
// The event log stamps each event's revision for subscription cursors.
// Client-provided message identity is correlated separately when the provider
// echoes sent inputs.

import type { SessionConnection } from "@providers/server/provider";
import { evictCachedSessionIfStale, releaseSession } from "@sessions/server/state/registry";
import { cacheSnapshot, loadSessionSnapshot } from "@sessions/server/state/snapshots";
import { setSessionActivity } from "@sessions/server/state/activity";
import { createToolCallProjector } from "@sessions/server/toolProjection";
import { systemMessageCoalesceKey } from "@sessions/model/systemMessages";
import { areModelConfigurationsEqual } from "@providers/model";
import type { SessionQuestionAnswer } from "@sessions/model/protocol";
import { applySessionEvent, createInitialSessionState } from "@sessions/model/reducer";
import { latestMessages } from "@sessions/model/transcriptPages";
import { hasBlockingSessionQuestion, hasPendingSessionQuestion } from "@sessions/model/questions";
import type {
  SessionArtifact,
  SessionCompletion,
  SessionEvent,
  SessionMessage,
  SessionState,
  SessionSubscriptionEvent,
} from "@sessions/model";
import { broadcast } from "@workspace/server/events";
import { sharedMap } from "@/shared/server/processState";
import { createSessionEventLog } from "./eventLog";

type MessageDisposition = "started" | "queued";
type StreamEndReason = Extract<SessionEvent, { type: "end" }>["reason"];

// Replay retention cap. A subscriber whose cursor falls behind it gets a
// snapshot instead, so the cap trades a rare larger frame for bounded memory.
const MAX_REPLAY_EVENTS = 1500;

// Dev HMR can reload this module while active turns are still running. Keep the
// registry on globalThis so reconnects and stop requests keep finding the same
// runtime object. A registered execution is therefore expected to mean "active or
// reconnectable"; terminal paths must finish or dispose it so idle sessions disappear.
export class SessionExecution {
  // ── Static registry and controls ─────────────────────────────────────

  private static readonly executions = sharedMap<SessionExecution>("session-executions");

  static get(sessionId: string): SessionExecution | undefined {
    return SessionExecution.executions.get(sessionId);
  }

  /** @internal acquireSessionExecution is the production caller. */
  static getOrCreate(
    sessionId: string,
    session: SessionConnection,
    initialState?: Partial<SessionState>,
  ): SessionExecution {
    const existing = SessionExecution.executions.get(sessionId);
    if (existing) {
      return existing;
    }

    const execution = new SessionExecution(sessionId, session, initialState);
    SessionExecution.executions.set(sessionId, execution);
    return execution;
  }

  static isRunning(sessionId: string): boolean {
    return SessionExecution.executions.has(sessionId);
  }

  static async waitForCompletion(
    sessionId: string,
    timeoutMs?: number,
  ): Promise<SessionCompletion> {
    const execution = SessionExecution.get(sessionId);
    if (!execution) {
      return completionResult((await loadSessionSnapshot(sessionId)).messages);
    }
    return execution.waitForCompletion(timeoutMs);
  }

  /**
   * Remove the live runtime as part of deleting its durable session.
   * Provider work is aborted and subscribers receive a terminal event, but a
   * deleted session publishes no idle/unread update. Completion waiters still
   * settle cleanly.
   */
  static async remove(sessionId: string): Promise<void> {
    const execution = SessionExecution.executions.get(sessionId);
    if (!execution) return;
    await execution.removeForDeletion();
  }

  // ── Instance fields ──────────────────────────────────────────────────

  readonly sessionId: string;
  /** Underlying provider session used by runtime-owned operations. */
  readonly connection: SessionConnection;

  readonly #log: ReturnType<typeof createSessionEventLog>;

  // Settles once, when this execution finishes or is deleted.
  readonly #completion = Promise.withResolvers<SessionCompletion>();
  #unsubscribeProvider: () => void;

  #sessionState: SessionState;

  // Claimed synchronously before #startTurn awaits so concurrent deliveries
  // cannot both open the execution's first turn.
  #hasOpenedTurn = false;
  #abortRequested = false;
  #finished = false;

  private constructor(
    sessionId: string,
    connection: SessionConnection,
    initialState?: Partial<SessionState>,
  ) {
    this.sessionId = sessionId;
    this.connection = connection;
    this.#sessionState = createInitialSessionState(initialState);
    // The log continues this state, so a client holding a seed's revision, or a
    // draft's 0, replays from the first event.
    this.#log = createSessionEventLog(MAX_REPLAY_EVENTS, this.#sessionState.revision);

    const project = createToolCallProjector(sessionId);
    this.#unsubscribeProvider = connection.onEvent((event) => {
      for (const domainEvent of project(event)) this.#handleProviderEvent(domainEvent);
    });
  }

  // ── Live stream surface ──────────────────────────────────────────────

  /** Bring a subscriber current from its cursor, then forward live events until this execution ends. */
  subscribe(
    send: (event: SessionSubscriptionEvent) => void,
    close: VoidFunction,
    after?: number,
  ): VoidFunction {
    const replay = this.#log.replay(after);
    if (replay) {
      for (const event of replay) send(event);
      send({ type: "resumed" });
    } else {
      send({ type: "snapshot", state: latestMessages(this.#sessionState) });
    }
    if (this.#finished) {
      close();
      return () => {};
    }
    return this.#log.subscribe((event) => {
      send(event);
      if (event.type === "end") close();
    });
  }

  /** Start the first message, or dispatch queued work when the assistant is ready. */
  async deliver(message: SessionMessage): Promise<MessageDisposition> {
    if (this.#finished || this.#abortRequested) {
      throw new SessionExecutionFinishedError();
    }

    if (!this.#hasOpenedTurn) {
      this.#hasOpenedTurn = true;
      await this.#startTurn(deferMessage(message));
      return "started";
    }

    const queuedMessage = message.immediate && this.#isSubmitting ? deferMessage(message) : message;

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

    if (this.#sessionState.status === "background") void this.#drainMessageQueue();
    return "queued";
  }

  async steerQueuedMessage(clientId: string): Promise<boolean> {
    if (this.#abortRequested || this.#isSubmitting) return false;

    const message = this.#sessionState.queuedMessages.find(
      (candidate) => candidate.clientId === clientId,
    );
    if (message?.role !== "user" || message.status !== "queued") {
      return false;
    }

    await this.#submitMessage({ ...messageFromQueue(message), immediate: true });
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

  /** Wait for this execution instance to complete, not future replacements with the same ID. */
  waitForCompletion(timeoutMs?: number): Promise<SessionCompletion> {
    if (timeoutMs === undefined || timeoutMs < 0) return this.#completion.promise;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<SessionCompletion>((resolve) => {
      timer = setTimeout(
        () => resolve(completionResult(this.#sessionState.messages, "timed_out")),
        timeoutMs,
      );
    });
    return Promise.race([this.#completion.promise, timeout]).finally(() => clearTimeout(timer));
  }

  getSessionState(): SessionState {
    return this.#sessionState;
  }

  updateArtifacts(artifacts: SessionArtifact[]): void {
    if (this.#finished) return;
    this.#emit({ type: "artifacts_changed", artifacts });
  }

  // ── Execution controls ───────────────────────────────────────────────

  /** @internal Complete this execution; external controls should abort or delete the session. */
  finish(reason: StreamEndReason = "idle", error?: string): void {
    if (this.#finished) return;
    this.#finished = true;
    this.#emit({ type: "end", reason, ...(error ? { error } : {}) });
    this.#completion.resolve(
      completionResult(this.#sessionState.messages, reason === "error" ? "failed" : "completed"),
    );
    if (reason === "idle" && !this.#abortRequested) {
      cacheSnapshot(this.sessionId, this.#sessionState);
    }
    // A finished turn waits to be read, even by a watching client, which marks it
    // read itself. A stopped one was already seen.
    setSessionActivity(this.sessionId, this.#abortRequested ? "idle" : "unread");
    this.#dispose();
    releaseSession(this.sessionId);
  }

  /** Always finish the execution, even if the SDK abort itself fails. */
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

  private async removeForDeletion(): Promise<void> {
    this.#abortRequested = true;
    if (!this.#finished) this.#emit({ type: "end", reason: "idle" });
    this.#dispose();
    await this.connection.abort();
  }

  // ── Turn execution ───────────────────────────────────────────────────

  async #startTurn(message: SessionMessage): Promise<void> {
    this.#emit({ type: "status", status: "thinking" });

    try {
      // The provider announces the model it applies.
      if (
        message.role === "user" &&
        message.model &&
        !areModelConfigurationsEqual(message.model, this.#sessionState.model)
      ) {
        await this.connection.setModel(message.model);
      }

      await this.connection.send(message);
    } catch (error) {
      evictCachedSessionIfStale(this.sessionId, error);
      this.finish("error");
      throw error;
    }
  }

  // ── Provider event handling ───────────────────────────────────────────────

  #handleProviderEvent(event: SessionEvent): void {
    if (this.#finished) return;
    if (event.type === "session_title_changed") {
      broadcast({
        type: "session.upserted",
        session: { id: this.sessionId, title: event.title },
      });
      return;
    }
    if (event.type === "end") {
      if (event.reason === "error") {
        if (!this.#abortRequested) this.finish("error", event.error);
      } else {
        void this.#drainMessageQueue(true);
      }
      return;
    }
    this.#emit(event);
    if (this.#sessionState.status === "background") void this.#drainMessageQueue();
  }

  async #drainMessageQueue(finishWhenEmpty = false): Promise<void> {
    if (
      this.#abortRequested ||
      this.#finished ||
      this.#isSubmitting ||
      hasBlockingSessionQuestion(this.#sessionState)
    ) {
      return;
    }

    const queuedMessage = this.#sessionState.queuedMessages[0];
    if (!queuedMessage) {
      if (finishWhenEmpty) this.finish();
      return;
    }
    if (queuedMessage.status !== "queued") return;

    try {
      await this.#submitMessage(messageFromQueue(queuedMessage));
    } catch {
      // #startTurn already finished the execution; this runs from a floating SDK handler.
    }
  }

  // ── Event emission ───────────────────────────────────────────────────

  #emit(event: SessionEvent): void {
    const published = this.#log.publish(event);
    this.#sessionState = applySessionEvent(this.#sessionState, published);
    if (
      published.type === "status" ||
      published.type === "question_requested" ||
      published.type === "question_resolved" ||
      published.type === "question_cancelled"
    ) {
      const status = this.#sessionState.status === "background" ? "background" : "running";
      setSessionActivity(
        this.sessionId,
        hasBlockingSessionQuestion(this.#sessionState) ? "waiting" : status,
      );
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────────

  /** A queued message is mid-submission, so the next one must wait. */
  get #isSubmitting(): boolean {
    return this.#sessionState.queuedMessages.some(({ status }) => status === "submitting");
  }

  async #submitMessage(message: SessionMessage): Promise<void> {
    this.#emit({ type: "message_queued", message });
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
    } finally {
      if (this.#sessionState.status === "background") void this.#drainMessageQueue();
    }
  }

  #dispose(): void {
    // Session deletion can dispose without the domain finish transition. Mark
    // the execution finished so a stale reference cannot emit a terminal event or
    // accept a message after registry removal.
    this.#finished = true;

    this.#completion.resolve(completionResult(this.#sessionState.messages));
    this.#unsubscribeProvider();
    SessionExecution.executions.delete(this.sessionId);
  }
}

export class SessionExecutionFinishedError extends Error {
  constructor() {
    super("Session execution finished before the message could be delivered.");
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
  const lastMessage = messages.at(-1);
  const error =
    status === "failed" && lastMessage?.role === "assistant" ? lastMessage.error : undefined;
  const result = { status, ...(error ? { error } : {}) };
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "assistant" && message.content.trim().length > 0) {
      return { ...result, response: message.content };
    }
  }

  return result;
}
