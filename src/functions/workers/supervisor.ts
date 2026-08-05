// Owner-scoped session execution. The worker supervisor centralizes inherited
// context, exact completion, cancellation, and ephemeral-lifetime cleanup.

import { readSessionContext } from "@/functions/sdk/client";
import { deleteSessionIfExists } from "@/functions/state/session/registry";
import { loadSessionSnapshot } from "@/functions/state/session/snapshots";
import { getEphemeralWorkerSessionIds } from "@/functions/state/session/workers";
import { workerParentSessionId } from "@/lib/workers";
import type { SessionCompletion, SessionLaunch, Worker } from "@/types";
import { sharedMap, sharedSet } from "@/functions/runtime/processState";
import { createSession, SessionStream } from "@/functions/runtime/stream";

export type SpawnWorkerInput = SessionLaunch & {
  worker: Worker;
};

export type WorkerReceipt = {
  sessionId: string;
  waitForCompletion: () => Promise<SessionCompletion>;
};

const startupSweeps = sharedMap<Promise<void>>("worker-startup-sweeps");
const activeWorkers = sharedSet<string>("active-workers");
const cancelingWorkers = sharedSet<string>("canceling-workers");

export class WorkerCanceledError extends Error {
  constructor(sessionId: string) {
    super(`Worker ${sessionId} was canceled.`);
    this.name = "WorkerCanceledError";
  }
}

/** Spawn one worker session and supervise its execution and lifetime. */
export async function spawnWorker(input: SpawnWorkerInput): Promise<WorkerReceipt> {
  const { worker } = input;
  const sessionId = worker.sessionId;
  const parentSessionId = workerParentSessionId(worker);
  if (activeWorkers.has(sessionId)) throw new Error(`Worker ${sessionId} is already active.`);
  activeWorkers.add(sessionId);

  let receipt;
  try {
    await ensureWorkersSwept();
    throwIfWorkerCanceled(sessionId);

    const parentStream = parentSessionId ? SessionStream.get(parentSessionId) : undefined;
    const [parentContext, parentSnapshot] = await Promise.all([
      input.directory === undefined && parentSessionId
        ? readSessionContext(parentSessionId)
        : undefined,
      input.message.model === undefined && parentSessionId && !parentStream
        ? loadSessionSnapshot(parentSessionId)
        : undefined,
    ]);
    throwIfWorkerCanceled(sessionId);
    const model =
      input.message.model ?? parentStream?.getSessionState().model ?? parentSnapshot?.model;

    receipt = await createSession(
      sessionId,
      { ...input.message, model },
      {
        directory: input.directory ?? parentContext?.workingDirectory,
        initialContext: parentContext,
        worker,
        useWorktree: input.useWorktree ?? false,
        ...(worker.name === undefined ? {} : { name: worker.name }),
      },
    );
    if (cancelingWorkers.has(sessionId)) {
      await SessionStream.get(sessionId)?.abort();
      throw new WorkerCanceledError(sessionId);
    }
  } catch (error) {
    try {
      return await cleanUpFailedSpawn(sessionId, error);
    } finally {
      releaseWorker(sessionId);
    }
  }

  const completion = superviseWorker(
    sessionId,
    worker.ephemeral,
    receipt.waitForCompletion,
  ).finally(() => {
    releaseWorker(sessionId);
  });
  // Supervision must continue even if a caller only needs the worker ID.
  // Attaching a handler prevents an unobserved cleanup failure from becoming
  // an unhandled rejection; callers still receive the original promise.
  void completion.catch(() => {});

  return {
    sessionId,
    waitForCompletion: () => completion,
  };
}

/** Cancel a worker whether its session stream is still spawning or already running. */
export async function cancelWorker(sessionId: string): Promise<boolean> {
  if (!activeWorkers.has(sessionId)) return false;

  cancelingWorkers.add(sessionId);
  const stream = SessionStream.get(sessionId);
  if (stream) await stream.abort();
  return true;
}

/** Delete workers whose supervising process ended before their completion. */
export async function sweepAbandonedWorkers(): Promise<void> {
  const sessionIds = await getEphemeralWorkerSessionIds();
  for (const sessionId of sessionIds) {
    await deleteSessionIfExists(sessionId);
  }
}

export function ensureWorkersSwept(): Promise<void> {
  const existing = startupSweeps.get("startup");
  if (existing) return existing;

  const sweep = sweepAbandonedWorkers().catch((error) => {
    if (startupSweeps.get("startup") === sweep) startupSweeps.delete("startup");
    throw error;
  });
  startupSweeps.set("startup", sweep);
  return sweep;
}

async function superviseWorker(
  sessionId: string,
  ephemeral: boolean,
  waitForCompletion: () => Promise<SessionCompletion>,
): Promise<SessionCompletion> {
  try {
    const completion = await waitForCompletion();
    if (cancelingWorkers.has(sessionId)) throw new WorkerCanceledError(sessionId);
    return completion;
  } finally {
    if (ephemeral) await deleteSessionIfExists(sessionId);
  }
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

function throwIfWorkerCanceled(sessionId: string): void {
  if (cancelingWorkers.has(sessionId)) throw new WorkerCanceledError(sessionId);
}

function releaseWorker(sessionId: string): void {
  activeWorkers.delete(sessionId);
  cancelingWorkers.delete(sessionId);
}
