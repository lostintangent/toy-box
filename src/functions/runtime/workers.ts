// Parent-owned session execution. The worker supervisor centralizes inherited
// context, exact completion, stopping, and retention-aware cleanup.

import { readSessionContext } from "@/functions/sdk/client";
import { deleteSessionIfExists } from "@/functions/state/session/registry";
import { loadSessionSnapshot } from "@/functions/state/session/snapshots";
import { getDisposableWorkerSessionIds } from "@/functions/state/session/workers";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";
import type { ModelConfiguration } from "@/types";
import { sharedMap, sharedSet } from "./processState";
import { createSession, SessionStream, type SessionStreamCompletion } from "./stream";

export type SpawnWorkerInput = {
  sessionId?: string;
  parentSessionId: string;
  name?: string;
  task: string;
  model?: ModelConfiguration;
  directory?: string;
  useWorktree?: boolean;
  retained?: boolean;
};

export type WorkerReceipt = {
  sessionId: string;
  waitForCompletion: () => Promise<SessionStreamCompletion>;
};

const startupSweeps = sharedMap<Promise<void>>("worker-startup-sweeps");
const activeWorkers = sharedSet<string>("active-workers");
const stoppingWorkers = sharedSet<string>("stopping-workers");

export class WorkerStoppedError extends Error {
  constructor(sessionId: string) {
    super(`Worker ${sessionId} was stopped.`);
    this.name = "WorkerStoppedError";
  }
}

/** Spawn one worker session and supervise it according to its retention policy. */
export async function spawnWorker(input: SpawnWorkerInput): Promise<WorkerReceipt> {
  const sessionId = input.sessionId ?? `${SESSION_ID_PREFIX}${crypto.randomUUID()}`;
  const retained = input.retained ?? false;
  if (activeWorkers.has(sessionId)) throw new Error(`Worker ${sessionId} is already active.`);
  activeWorkers.add(sessionId);

  let receipt;
  try {
    await ensureWorkersSwept();
    throwIfWorkerStopping(sessionId);

    const parentStream = SessionStream.get(input.parentSessionId);
    const [parentContext, parentSnapshot] = await Promise.all([
      input.directory === undefined ? readSessionContext(input.parentSessionId) : undefined,
      input.model === undefined && !parentStream
        ? loadSessionSnapshot(input.parentSessionId)
        : undefined,
    ]);
    throwIfWorkerStopping(sessionId);
    const model = input.model ?? parentStream?.getSessionState().model ?? parentSnapshot?.model;

    receipt = await createSession(
      sessionId,
      { content: input.task, model },
      {
        directory: input.directory ?? parentContext?.workingDirectory,
        initialContext: parentContext,
        worker: { parentSessionId: input.parentSessionId, retained },
        useWorktree: input.useWorktree ?? false,
        ...(input.name === undefined ? {} : { name: input.name }),
      },
    );
    if (stoppingWorkers.has(sessionId)) {
      await SessionStream.get(sessionId)?.abort();
      throw new WorkerStoppedError(sessionId);
    }
  } catch (error) {
    try {
      return await cleanUpFailedSpawn(sessionId, error);
    } finally {
      releaseWorker(sessionId);
    }
  }

  const completion = superviseWorker(sessionId, retained, receipt.waitForCompletion).finally(() => {
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

/** Stop a worker whether its session stream is still spawning or already running. */
export async function stopWorker(sessionId: string): Promise<boolean> {
  if (!activeWorkers.has(sessionId)) return false;

  stoppingWorkers.add(sessionId);
  const stream = SessionStream.get(sessionId);
  if (stream) await stream.abort();
  return true;
}

/** Delete workers whose supervising process ended before their completion. */
export async function sweepAbandonedWorkers(): Promise<void> {
  const sessionIds = await getDisposableWorkerSessionIds();
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
  retained: boolean,
  waitForCompletion: () => Promise<SessionStreamCompletion>,
): Promise<SessionStreamCompletion> {
  try {
    return await waitForCompletion();
  } finally {
    if (!retained) await deleteSessionIfExists(sessionId);
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

function throwIfWorkerStopping(sessionId: string): void {
  if (stoppingWorkers.has(sessionId)) throw new WorkerStoppedError(sessionId);
}

function releaseWorker(sessionId: string): void {
  activeWorkers.delete(sessionId);
  stoppingWorkers.delete(sessionId);
}
