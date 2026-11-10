// Public operations for the session runtime. Callers create, recreate, or deliver
// without observing, and follow a live execution separately from a replay cursor.
// Every mutation acquires the same live runtime.

import { listSessionArtifacts } from "../artifacts";
import type { SessionQuestionAnswer } from "@sessions/model/protocol";
import type {
  SessionCompletion,
  SessionLaunch,
  SessionMessage,
  SessionState,
  SessionSystemMessage,
} from "@sessions/model";
import * as sessionRegistry from "@sessions/server/state/registry";
import { loadSessionSnapshot, refreshSessionSnapshot } from "@sessions/server/state/snapshots";
import { broadcast } from "@workspace/server/events";
import { sharedMap } from "@/shared/server/processState";
import { SessionExecution, SessionExecutionFinishedError } from "./sessionExecution";
import type { SessionSubscription } from "./eventBus";

export { getSessionDirectory } from "../providers";
export { deleteSession, deleteSessionIfExists, releaseIdleSession } from "../state/registry";

type PendingSessionCompletion = {
  promise: Promise<SessionCompletion>;
  resolve: (completion: SessionCompletion) => boolean;
  reject: (error: unknown) => boolean;
};

const SETTLED_SESSION_COMPLETION_RETENTION_MS = 5 * 60_000;

// Sessions announced before their live execution exists remain waitable by ID.
const pendingSessionCompletions = sharedMap<PendingSessionCompletion>(
  "pending-session-completions",
);

/** Register a session that callers may wait for before its live execution exists. */
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
  if (!pending) return SessionExecution.waitForCompletion(sessionId, timeoutMs);
  if (timeoutMs === undefined) return pending.promise;
  return waitForPendingSession(pending.promise, timeoutMs);
}

/** Read the current canonical state, whether the session is live, starting, or persisted. */
export async function getSessionSnapshot(sessionId: string): Promise<SessionState> {
  const execution = await currentSessionExecution(sessionId);
  return execution ? execution.getSessionState() : loadSessionSnapshot(sessionId);
}

export function isSessionRunning(sessionId: string): boolean {
  return SessionExecution.isRunning(sessionId);
}

export function getSessionRuntimeStatus(sessionId: string): {
  running: boolean;
  queuedCount: number;
} {
  const execution = SessionExecution.get(sessionId);
  return {
    running: execution !== undefined || startingExecutions.has(sessionId),
    queuedCount: execution?.getSessionState().queuedMessages.length ?? 0,
  };
}

export function cancelQueuedMessage(sessionId: string, clientId: string): boolean {
  return SessionExecution.get(sessionId)?.cancelQueuedMessage(clientId) ?? false;
}

export async function steerQueuedMessage(sessionId: string, clientId: string): Promise<boolean> {
  return SessionExecution.get(sessionId)?.steerQueuedMessage(clientId) ?? false;
}

export async function abortSession(sessionId: string): Promise<boolean> {
  const execution = SessionExecution.get(sessionId);
  if (!execution) return false;
  await execution.abort();
  return true;
}

export async function answerSessionQuestion(
  sessionId: string,
  answer: SessionQuestionAnswer,
): Promise<boolean> {
  return SessionExecution.get(sessionId)?.answerQuestion(answer) ?? false;
}

/** Discard one root user turn and every later conversation event while preserving files. */
export async function rewindSession(sessionId: string, timestamp: string): Promise<SessionState> {
  if (SessionExecution.isRunning(sessionId))
    throw new Error("Stop this session before rewinding it.");
  await sessionRegistry.withSession(sessionId, (session) => session.rewind(timestamp));

  const snapshot = await refreshSessionSnapshot(sessionId);
  // The SDK's snapshot_rewind event is ephemeral and idle sessions have no
  // SessionExecution, so notify other browser clients through the shared plane.
  broadcast({ type: "session.touched", sessionId });
  return snapshot;
}

/** Filesystem observation refreshes artifact membership for active sessions. */
export async function refreshSessionArtifacts(sessionId: string): Promise<void> {
  const execution = SessionExecution.get(sessionId);
  if (execution) execution.updateArtifacts(await listSessionArtifacts(sessionId));
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

/** Follow a session's live execution after a replay cursor, or nothing when it is idle. */
export async function followSession(
  sessionId: string,
  afterEventId?: number,
): Promise<SessionSubscription | undefined> {
  return (await currentSessionExecution(sessionId))?.subscribe(afterEventId);
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
  await sessionRegistry.createSessionRecord(sessionId, { title: options.name });
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
  let retriedFinishedExecution = false;
  let retriedStaleSession = false;

  for (;;) {
    try {
      const execution = await acquireSessionExecution(sessionId, normalizedMessage, create);
      const disposition = await execution.deliver(normalizedMessage);
      return {
        disposition,
        waitForCompletion: () => execution.waitForCompletion(),
      };
    } catch (error) {
      if (error instanceof SessionExecutionFinishedError && !retriedFinishedExecution) {
        retriedFinishedExecution = true;
        continue;
      }

      // A stale cached SDK session (possible on the snapshot-seed path, which
      // skips the replay path's getEvents probe) surfaces as a send failure
      // after turn start evicts it and finishes the execution. No client is subscribed
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

// Covers concurrent acquisition before the execution reaches the registry.
const startingExecutions = sharedMap<Promise<SessionExecution>>("starting-session-executions");

/** The live execution, including one still being acquired. A failed acquisition belongs to its initiator. */
async function currentSessionExecution(sessionId: string): Promise<SessionExecution | undefined> {
  return (
    SessionExecution.get(sessionId) ?? startingExecutions.get(sessionId)?.catch(() => undefined)
  );
}

/** Single-flight get-or-create. SessionExecution.deliver owns first-turn selection. */
async function acquireSessionExecution(
  sessionId: string,
  message: SessionMessage,
  create?: SessionCreationOptions,
): Promise<SessionExecution> {
  const existing = SessionExecution.get(sessionId);
  if (existing) return existing;

  const pending = startingExecutions.get(sessionId);
  if (pending) return pending;

  const creation = createExecutionForMessage(sessionId, message, create).finally(() => {
    startingExecutions.delete(sessionId);
  });
  startingExecutions.set(sessionId, creation);
  return creation;
}

async function createExecutionForMessage(
  sessionId: string,
  message: SessionMessage,
  create?: SessionCreationOptions,
): Promise<SessionExecution> {
  if (create) {
    const model = message.role === "user" ? message.model : undefined;
    const created = await sessionRegistry.createSession(sessionId, {
      ...create,
      model,
    });
    return SessionExecution.getOrCreate(sessionId, created.session, {
      ...(created.artifactPath ? { artifacts: await listSessionArtifacts(sessionId) } : {}),
      ...(model ? { model } : {}),
    });
  }

  // Rebuild history before taking the execution lease so a replay failure
  // cannot strand a session as active. Refresh configuration immediately after.
  const snapshot = await loadSessionSnapshot(sessionId);
  const sdkSession = await sessionRegistry.acquireSession(sessionId);
  const { lastSeenEventId: _lastSeenEventId, ...snapshotState } = snapshot;
  const execution = SessionExecution.getOrCreate(sessionId, sdkSession, snapshotState);
  // This replacement is now the session's current execution. Retained
  // completion receipts remain valid for existing waiters, but must no longer
  // answer future ID-based waits for an earlier execution.
  pendingSessionCompletions.delete(sessionId);
  return execution;
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
