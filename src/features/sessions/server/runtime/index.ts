// Public operations for the session runtime. Headless callers explicitly
// create, recreate, or deliver; connected callers use one composite that subscribes while
// optionally doing either. Every mutation acquires the same live runtime.

import { listSessionArtifacts, writeSessionArtifact } from "../artifacts";
import type { SessionQuestionAnswer, StreamSessionRequest } from "@sessions/model/protocol";
import type {
  SessionCompletion,
  SessionLaunch,
  SessionMessage,
  SessionState,
  SessionSystemMessage,
} from "@sessions/model";
import * as sessionRegistry from "@sessions/server/state/registry";
import { loadSessionSnapshot, refreshSessionSnapshot } from "@sessions/server/state/snapshots";
import { emitSessionTouched } from "@workspace/server/events";
import { sharedMap } from "@/shared/server/processState";
import { SessionStream, SessionStreamFinishedError } from "./sessionStream";
import type { SessionStreamSubscription } from "./eventBus";

export { getSessionDirectory } from "../providers";
export { deleteSession, deleteSessionIfExists, releaseIdleSession } from "../state/registry";
export { isSessionNotFoundError } from "../state/registry";

type PendingSessionCompletion = {
  promise: Promise<SessionCompletion>;
  resolve: (completion: SessionCompletion) => boolean;
  reject: (error: unknown) => boolean;
};

const SETTLED_SESSION_COMPLETION_RETENTION_MS = 5 * 60_000;

// Sessions announced before their live stream exists remain waitable by ID.
const pendingSessionCompletions = sharedMap<PendingSessionCompletion>(
  "pending-session-completions",
);

/** Register a session that callers may wait for before its live stream exists. */
export function registerPendingSessionCompletion(sessionId: string): PendingSessionCompletion {
  if (pendingSessionCompletions.has(sessionId)) {
    throw new Error(`Session ${sessionId} already has a pending completion.`);
  }

  let complete!: (completion: SessionCompletion) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<SessionCompletion>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  let settled = false;
  let receipt!: PendingSessionCompletion;
  const settle = (finish: () => void) => {
    if (settled) return false;
    settled = true;
    finish();
    // A managed Session may be deleted immediately after completion, before a
    // waiter attaches. Keep its exact result briefly so fast teardown cannot
    // become a misleading "session not found" result.
    const expiration = setTimeout(() => {
      if (pendingSessionCompletions.get(sessionId) === receipt) {
        pendingSessionCompletions.delete(sessionId);
      }
    }, SETTLED_SESSION_COMPLETION_RETENTION_MS);
    expiration.unref();
    return true;
  };
  receipt = {
    promise,
    resolve: (completion) => settle(() => complete(completion)),
    reject: (error) => settle(() => fail(error)),
  };
  pendingSessionCompletions.set(sessionId, receipt);
  void promise.catch(() => {});
  return receipt;
}

/** Reject an announced session that was canceled before completion. */
export function rejectPendingSessionCompletion(sessionId: string, error: unknown): boolean {
  const receipt = pendingSessionCompletions.get(sessionId);
  if (!receipt) return false;
  return receipt.reject(error);
}

/** Monitor the announced, live, or latest persisted execution for each session ID. */
export function waitForSessions(
  sessionIds: readonly string[],
  timeoutMs?: number,
): Promise<SessionCompletion[]> {
  return Promise.all(sessionIds.map((sessionId) => waitForSession(sessionId, timeoutMs)));
}

function waitForSession(sessionId: string, timeoutMs?: number): Promise<SessionCompletion> {
  const pending = pendingSessionCompletions.get(sessionId);
  if (!pending) return SessionStream.waitForCompletion(sessionId, timeoutMs);
  if (timeoutMs === undefined) return pending.promise;
  return waitForPendingSession(pending.promise, timeoutMs);
}

/** Read the current canonical state, whether the session is live or persisted. */
export async function getSessionSnapshot(sessionId: string): Promise<SessionState> {
  const stream = SessionStream.get(sessionId);
  return stream ? stream.getSessionState() : loadSessionSnapshot(sessionId);
}

export function isSessionRunning(sessionId: string): boolean {
  return SessionStream.isRunning(sessionId);
}

export function getSessionRuntimeStatus(sessionId: string): {
  running: boolean;
  queuedCount: number;
} {
  const stream = SessionStream.get(sessionId);
  return {
    running: stream !== undefined,
    queuedCount: stream?.getSessionState().queuedMessages.length ?? 0,
  };
}

export function cancelQueuedMessage(sessionId: string, clientId: string): boolean {
  return SessionStream.get(sessionId)?.cancelQueuedMessage(clientId) ?? false;
}

export async function steerQueuedMessage(sessionId: string, clientId: string): Promise<boolean> {
  return SessionStream.get(sessionId)?.steerQueuedMessage(clientId) ?? false;
}

export async function abortSession(sessionId: string): Promise<boolean> {
  const stream = SessionStream.get(sessionId);
  if (!stream) return false;
  await stream.abort();
  return true;
}

export async function answerSessionQuestion(
  sessionId: string,
  answer: SessionQuestionAnswer,
): Promise<boolean> {
  return SessionStream.get(sessionId)?.answerQuestion(answer) ?? false;
}

/** Discard one root user turn and every later conversation event while preserving files. */
export async function rewindSession(sessionId: string, timestamp: string): Promise<SessionState> {
  if (SessionStream.isRunning(sessionId)) throw new Error("Stop this session before rewinding it.");
  await sessionRegistry.withSession(sessionId, (session) => session.rewind(timestamp));

  const snapshot = await refreshSessionSnapshot(sessionId);
  // The SDK's snapshot_rewind event is ephemeral and idle sessions have no
  // SessionStream, so notify other browser clients through the shared plane.
  emitSessionTouched(sessionId);
  return snapshot;
}

export async function createSessionArtifact(
  sessionId: string,
  path: string,
  content: string,
): Promise<void> {
  const stream = SessionStream.get(sessionId);
  if (!stream) throw new Error("Cannot create a session artifact without a running session.");
  await writeSessionArtifact(sessionId, path, content);
}

/** Filesystem observation refreshes artifact membership for active sessions. */
export async function refreshSessionArtifacts(sessionId: string): Promise<void> {
  const stream = SessionStream.get(sessionId);
  if (stream) stream.updateArtifacts(await listSessionArtifacts(sessionId));
}

function waitForPendingSession(
  completion: Promise<SessionCompletion>,
  timeoutMs: number,
): Promise<SessionCompletion> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ status: "timed_out" }), Math.max(0, timeoutMs));
    completion.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Stream a session, optionally creating it and delivering a message.
 * Subscriptions are active by default; passive ones do not acknowledge completion.
 */
export async function streamSession(
  request: StreamSessionRequest,
): Promise<SessionStreamSubscription | undefined> {
  if (!request.message) {
    const stream = SessionStream.get(request.sessionId);
    return stream?.subscribe(request.afterEventId, request.mode);
  }

  const message = normalizeMessage(request.message);
  const create = request.location;
  let retriedFinishedStream = false;

  for (;;) {
    const stream = await acquireSessionStream(request.sessionId, message, create);
    // Subscribe eagerly before delivery. If another caller already opened the
    // turn, deliver() queues this message and this same subscription follows the
    // active stream through the queued turn instead of returning event-less.
    const events = stream.subscribe(request.afterEventId);

    try {
      await stream.deliver(message);
    } catch (error) {
      if (error instanceof SessionStreamFinishedError && !retriedFinishedStream) {
        retriedFinishedStream = true;
        await events.return();
        continue;
      }

      // Turn-start failures publish their canonical end/error event before
      // rejecting. Drain those events so the client sees the domain failure
      // rather than a transport exception.
    }

    return events;
  }
}

type MessageInput =
  | SessionLaunch["message"]
  | { clientId?: string; systemMessage: SessionSystemMessage; immediate?: true };

type SessionCreationOptions = Omit<sessionRegistry.CreateSessionOptions, "model">;

/** Create a session through its required first message without subscribing. */
export function createSession(
  sessionId: string,
  message: MessageInput,
  options: SessionCreationOptions,
) {
  return deliver(sessionId, message, options);
}

/** Recreate a session through its first message while retaining its public ID. */
export async function recreateSession(
  sessionId: string,
  message: MessageInput,
  options: SessionCreationOptions,
) {
  await sessionRegistry.deleteSessionIfExists(sessionId, { publish: false });
  await sessionRegistry.createSessionRecord(sessionId, {
    title: options.name,
    sessionType: options.sessionType,
  });
  try {
    return await createSession(sessionId, message, options);
  } catch (error) {
    await sessionRegistry.deleteSessionIfExists(sessionId);
    throw error;
  }
}

/** Deliver to an existing session without subscribing. */
export function deliverSessionMessage(sessionId: string, message: MessageInput) {
  return deliver(sessionId, message);
}

async function deliver(sessionId: string, message: MessageInput, create?: SessionCreationOptions) {
  const normalizedMessage = normalizeMessage(message);
  let retriedFinishedStream = false;
  let retriedStaleSession = false;

  for (;;) {
    try {
      const stream = await acquireSessionStream(sessionId, normalizedMessage, create);
      const disposition = await stream.deliver(normalizedMessage);
      return {
        disposition,
        waitForCompletion: () => stream.waitForCompletion(),
      };
    } catch (error) {
      if (error instanceof SessionStreamFinishedError && !retriedFinishedStream) {
        retriedFinishedStream = true;
        continue;
      }

      // A stale cached SDK session (possible on the snapshot-seed path, which
      // skips the replay path's getEvents probe) surfaces as a send failure
      // after turn start evicts it and finishes the stream. No client is subscribed
      // to retry, so rebuild once — the resume is fresh by construction and the
      // cached snapshot is still valid (the log never changed).
      if (!retriedStaleSession && sessionRegistry.evictCachedSessionIfStale(sessionId, error)) {
        retriedStaleSession = true;
        continue;
      }

      throw error;
    }
  }
}

// Covers concurrent acquisition before the stream reaches the registry.
const pendingStreamCreations = sharedMap<Promise<SessionStream>>("pending-session-streams");

/** Single-flight get-or-create. SessionStream.deliver owns first-turn selection. */
async function acquireSessionStream(
  sessionId: string,
  message: SessionMessage,
  create?: SessionCreationOptions,
): Promise<SessionStream> {
  const existing = SessionStream.get(sessionId);
  if (existing) return existing;

  const pending = pendingStreamCreations.get(sessionId);
  if (pending) return pending;

  const creation = createStreamForMessage(sessionId, message, create).finally(() => {
    pendingStreamCreations.delete(sessionId);
  });
  pendingStreamCreations.set(sessionId, creation);
  return creation;
}

async function createStreamForMessage(
  sessionId: string,
  message: SessionMessage,
  create?: SessionCreationOptions,
): Promise<SessionStream> {
  if (create) {
    const model = message.role === "user" ? message.model : undefined;
    const created = await sessionRegistry.createSession(sessionId, {
      ...create,
      model,
    });
    return SessionStream.getOrCreate(sessionId, created.session, {
      ...(created.artifactPath ? { artifacts: await listSessionArtifacts(sessionId) } : {}),
      ...(model ? { model } : {}),
    });
  }

  // Rebuild history before taking the execution lease so a replay failure
  // cannot strand a session as active. Refresh configuration immediately after.
  const snapshot = await loadSessionSnapshot(sessionId);
  const sdkSession = await sessionRegistry.acquireSession(sessionId);
  const { lastSeenEventId: _lastSeenEventId, ...snapshotState } = snapshot;
  const stream = SessionStream.getOrCreate(sessionId, sdkSession, snapshotState);
  // This replacement stream is now the session's current execution. Retained
  // completion receipts remain valid for existing waiters, but must no longer
  // answer future ID-based waits for an earlier execution.
  pendingSessionCompletions.delete(sessionId);
  return stream;
}

function normalizeMessage(message: MessageInput): SessionMessage {
  const clientId = message.clientId ?? crypto.randomUUID();

  if ("systemMessage" in message) {
    return {
      clientId,
      role: "system",
      content: message.systemMessage,
      immediate: message.immediate,
    };
  }

  return {
    clientId,
    role: "user",
    content: message.content,
    attachments: message.attachments,
    model: message.model,
    immediate: message.immediate,
  } satisfies Extract<SessionMessage, { role: "user" }>;
}
