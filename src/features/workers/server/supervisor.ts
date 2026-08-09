// Owner-scoped session execution. The worker supervisor centralizes inherited
// context, exact completion, cancellation, and ephemeral-lifetime cleanup.

import { workerParentSessionId, type Worker } from "../model";
import type { SessionCompletion, SessionLaunch } from "@sessions/model";
import { getEphemeralWorkerSessionIds } from "./database";
import { sharedMap, sharedSet } from "@/shared/server/processState";
import {
  abortSession,
  createSession,
  deleteSessionIfExists,
  getSessionSnapshot,
  readSessionContext,
} from "@sessions/server/runtime";

type SpawnWorkerInput = SessionLaunch & {
  worker: Worker;
};

type WorkerReceipt = {
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

    const [parentContext, parentSnapshot] = await Promise.all([
      input.directory === undefined && parentSessionId
        ? readSessionContext(parentSessionId)
        : undefined,
      input.message.model === undefined && parentSessionId
        ? getSessionSnapshot(parentSessionId)
        : undefined,
    ]);
    throwIfWorkerCanceled(sessionId);
    const model = input.message.model ?? parentSnapshot?.model;

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
      await abortSession(sessionId);
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
  await abortSession(sessionId);
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
