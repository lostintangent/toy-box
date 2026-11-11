// Owner-scoped session execution. The worker supervisor centralizes inherited
// configuration, exact completion, cancellation, and owner-supplied retention.

import { workerParentSessionId, type Worker } from "../model";
import type { SessionCompletion, SessionLaunch } from "@sessions/model";
import {
  getEphemeralWorkerSessionIds,
  getPersistedWorker,
  registerWorkerSession,
} from "./database";
import { getProcessValue } from "@/shared/server/processState";
import {
  abortSession,
  createSession,
  deleteSessionIfExists,
  getSessionSnapshot,
  getSessionDirectory,
} from "@sessions/server/runtime";
import { startWorkerRun, WorkerCanceledError } from "./registry";

export type WorkerRetention =
  | "ephemeral"
  | "durable"
  | ((worker: Worker, completion: SessionCompletion) => boolean | Promise<boolean>);

type SuperviseWorkerInput<Value> = SessionLaunch & {
  worker: Worker;
  retention: WorkerRetention;
  admit?: () => Promise<Value>;
};

const startupSweep = getProcessValue<{ promise?: Promise<void> }>(
  "worker-startup-sweep",
  () => ({}),
);

/** Admit a durable Worker identity, then run it through execution and cleanup. */
export function superviseWorker<Value = void>(
  input: SuperviseWorkerInput<Value>,
): Promise<{ sessionId: string; value: Value | void }> {
  const { worker, message: inputMessage, location, retention } = input;
  const sessionId = worker.sessionId;
  const parentSessionId = workerParentSessionId(worker);
  const admission = Promise.withResolvers<{ sessionId: string; value: Value | void }>();
  const completion = startWorkerRun(worker, execute);
  // Failures reject admission until it settles; afterward they belong to completion.
  void completion.catch((error) => {
    admission.reject(error);
    if (!(error instanceof WorkerCanceledError)) console.error("Worker failed:", error);
  });
  return admission.promise;

  async function execute(signal: AbortSignal): Promise<SessionCompletion> {
    let admitted: { sessionId: string; value: Value | void } | undefined;
    let started = false;
    let result: SessionCompletion;
    try {
      await ensureWorkersSwept();
      signal.throwIfAborted();
      const value = await (input.admit ? input.admit() : registerWorkerSession(worker));
      signal.throwIfAborted();

      admitted = { sessionId, value };
      const [parentDirectory, parentSnapshot] = await Promise.all([
        location?.directory === undefined && parentSessionId
          ? getSessionDirectory(parentSessionId)
          : undefined,
        inputMessage.model === undefined && parentSessionId
          ? getSessionSnapshot(parentSessionId)
          : undefined,
      ]);
      signal.throwIfAborted();
      const message = {
        ...inputMessage,
        model: inputMessage.model ?? parentSnapshot?.model,
      };

      const starting = createSession(sessionId, message, {
        directory: location?.directory ?? parentDirectory,
        parentSessionId,
        useWorktree: location?.useWorktree ?? false,
        ...(worker.name === undefined ? {} : { name: worker.name }),
      });
      // Session acquisition is registered synchronously: follow-ups can now join its mailbox.
      admission.resolve(admitted);
      const receipt = await starting;
      if (signal.aborted) {
        await abortSession(sessionId);
        throw signal.reason;
      }
      started = true;
      result = await receipt.waitForCompletion();
      signal.throwIfAborted();
    } catch (error) {
      if (signal.aborted) {
        if (!started || worker.ephemeral) return cleanUpFailedSpawn(sessionId, signal.reason);
        throw signal.reason;
      }
      if (!admitted) return cleanUpFailedSpawn(sessionId, error);
      admission.resolve(admitted);
      result = { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }

    // Retention and cleanup are part of completion, but their failures are not execution outcomes.
    await applyRetention(sessionId, retention, result, signal);
    return result;
  }
}

/** Delete workers whose supervising process ended before their completion. */
export async function sweepAbandonedWorkers(): Promise<void> {
  const sessionIds = await getEphemeralWorkerSessionIds();
  for (const sessionId of sessionIds) {
    await deleteSessionIfExists(sessionId);
  }
}

export function ensureWorkersSwept(): Promise<void> {
  return (startupSweep.promise ??= sweepAbandonedWorkers().catch((error) => {
    startupSweep.promise = undefined;
    throw error;
  }));
}

async function applyRetention(
  sessionId: string,
  retention: WorkerRetention,
  completion: SessionCompletion,
  signal: AbortSignal,
): Promise<void> {
  let retain = retention === "durable";
  if (typeof retention === "function") {
    const worker = await getPersistedWorker(sessionId);
    signal.throwIfAborted();
    if (!worker) return;
    retain = await retention(worker, completion);
  }
  signal.throwIfAborted();
  if (!retain) await deleteSessionIfExists(sessionId);
}

async function cleanUpFailedSpawn(sessionId: string, spawnError: unknown): Promise<never> {
  try {
    await deleteSessionIfExists(sessionId);
  } catch (cleanupError) {
    throw new AggregateError(
      [spawnError, cleanupError],
      `Worker ${sessionId} failed to spawn and could not be cleaned up.`,
    );
  }
  throw spawnError;
}
