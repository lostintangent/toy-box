// Public operations for the session runtime. Callers create, recreate, or deliver
// without subscribing, and subscribe separately from a revision cursor. Every
// mutation acquires the same live runtime.

import { SessionNotFoundError } from "@providers/server/provider";
import { listSessionArtifacts } from "../artifacts";
import type { SessionQuestionAnswer } from "@sessions/model/protocol";
import type {
  SessionCompletion,
  SessionLaunch,
  SessionMessage,
  SessionState,
  SessionSubscriptionEvent,
  SessionSystemMessage,
} from "@sessions/model";
import { latestMessages } from "@sessions/model/transcriptPages";
import * as sessionRegistry from "@sessions/server/state/registry";
import { loadSessionSnapshot, refreshSessionSnapshot } from "@sessions/server/state/snapshots";
import { broadcast } from "@workspace/server/events";
import { sharedMap } from "@/shared/server/processState";
import { SessionExecution, SessionExecutionFinishedError } from "./sessionExecution";

export { getSessionDirectory } from "../providers";
export { deleteSession, deleteSessionIfExists, releaseIdleSession } from "../state/registry";

// Sessions whose owner runs work before their live execution exists remain waitable by ID.
const expectedCompletions = sharedMap<Promise<SessionCompletion>>("expected-session-completions");

/** Answer waits for a session with its owner's completion until a later execution replaces it. */
export function expectSessionCompletion(
  sessionId: string,
  completion: Promise<SessionCompletion>,
): void {
  expectedCompletions.set(sessionId, completion);
  // A managed Session may be deleted immediately after completion, before a
  // waiter attaches. Keep its exact result briefly so fast teardown cannot
  // become a misleading "session not found" result.
  const expire = () => {
    setTimeout(() => {
      if (expectedCompletions.get(sessionId) === completion) expectedCompletions.delete(sessionId);
    }, 5 * 60_000).unref();
  };
  void completion.then(expire, expire);
}

/** Monitor the announced, live, or latest persisted execution for each session ID. */
export function waitForSessions(
  sessionIds: readonly string[],
  timeoutMs?: number,
): Promise<SessionCompletion[]> {
  return Promise.all(sessionIds.map((sessionId) => waitForSession(sessionId, timeoutMs)));
}

function waitForSession(sessionId: string, timeoutMs?: number): Promise<SessionCompletion> {
  const expected = expectedCompletions.get(sessionId);
  if (!expected) return SessionExecution.waitForCompletion(sessionId, timeoutMs);
  if (timeoutMs === undefined) return expected;
  return waitForExpectedSession(expected, timeoutMs);
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

function waitForExpectedSession(
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

/** Bring a subscriber current from its cursor, then forward live events until the
 *  execution ends. An idle session closes once its subscriber is current. */
export async function subscribeToSession(
  sessionId: string,
  send: (event: SessionSubscriptionEvent) => void,
  close: VoidFunction,
  after?: number,
): Promise<VoidFunction> {
  try {
    const execution = await currentSessionExecution(sessionId);
    if (execution) return execution.subscribe(send, close, after);
    const snapshot = await loadSessionSnapshot(sessionId);
    if (snapshot.revision === after) {
      // A cached snapshot keeps its revision while its artifacts are listed fresh.
      send({ type: "artifacts_changed", artifacts: snapshot.artifacts });
      send({ type: "resumed" });
    } else {
      send({ type: "snapshot", state: latestMessages(snapshot) });
    }
  } catch (error) {
    if (!(error instanceof SessionNotFoundError)) throw error;
    send({ type: "deleted", sessionId });
  }
  close();
  return () => {};
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
  const execution = SessionExecution.getOrCreate(sessionId, sdkSession, snapshot);
  // This replacement is now the session's current execution. An expected
  // completion stays valid for existing waiters, but must no longer answer
  // future ID-based waits for an earlier execution.
  expectedCompletions.delete(sessionId);
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
