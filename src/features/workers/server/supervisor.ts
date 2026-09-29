// Owner-scoped session execution. The worker supervisor centralizes inherited
// configuration, exact completion, cancellation, and owner-supplied retention.

import { workerParentSessionId, type Worker } from "../model";
import type { SessionCompletion, SessionLaunch } from "@sessions/model";
import {
  getEphemeralWorkerSessionIds,
  getPersistedWorker,
  registerWorkerSession,
} from "./database";
import { sharedMap, sharedSet } from "@/shared/server/processState";
import {
  abortSession,
  createSession,
  deleteSessionIfExists,
  getSessionSnapshot,
  getSessionDirectory,
} from "@sessions/server/runtime";

export type WorkerRetention =
  | "ephemeral"
  | "durable"
  | ((worker: Worker, completion: SessionCompletion) => boolean | Promise<boolean>);

type SuperviseWorkerInput<Value> = SessionLaunch & {
  worker: Worker;
  retention: WorkerRetention;
  admit?: () => Promise<Value>;
};

export type WorkerReceipt<Value = void> = {
  sessionId: string;
  value: Value;
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

/** Admit a durable Worker identity; its receipt observes startup, execution, and cleanup. */
export function superviseWorker<Value = void>(
  input: SuperviseWorkerInput<Value>,
): Promise<WorkerReceipt<Value | void>> {
  const { worker, message: inputMessage, location, retention } = input;
  const sessionId = worker.sessionId;
  const parentSessionId = workerParentSessionId(worker);
  if (activeWorkers.has(sessionId)) {
    return Promise.reject(new Error(`Worker ${sessionId} is already active.`));
  }
  activeWorkers.add(sessionId);

  const admission = Promise.withResolvers<WorkerReceipt<Value | void>>();
  const completion: Promise<SessionCompletion> = execute().finally(() => {
    releaseWorker(sessionId);
  });
  // Failures reject admission until it settles; afterward they belong to completion.
  void completion.catch(admission.reject);
  return admission.promise;

  async function execute(): Promise<SessionCompletion> {
    let admitted: WorkerReceipt<Value | void> | undefined;
    let started = false;
    let result: SessionCompletion;
    try {
      await ensureWorkersSwept();
      throwIfWorkerCanceled(sessionId);
      const value = await (input.admit ? input.admit() : registerWorkerSession(worker));
      throwIfWorkerCanceled(sessionId);

      admitted = { sessionId, value, waitForCompletion: () => completion };
      const [parentDirectory, parentSnapshot] = await Promise.all([
        location?.directory === undefined && parentSessionId
          ? getSessionDirectory(parentSessionId)
          : undefined,
        inputMessage.model === undefined && parentSessionId
          ? getSessionSnapshot(parentSessionId)
          : undefined,
      ]);
      throwIfWorkerCanceled(sessionId);
      const message = {
        ...inputMessage,
        model: inputMessage.model ?? parentSnapshot?.model,
      };

      const starting = createSession(sessionId, message, {
        directory: location?.directory ?? parentDirectory,
        sessionType: "worker",
        parentSessionId,
        useWorktree: location?.useWorktree ?? false,
        ...(worker.name === undefined ? {} : { name: worker.name }),
      });
      // Session acquisition is registered synchronously: follow-ups can now join its mailbox.
      admission.resolve(admitted);
      const receipt = await starting;
      if (cancelingWorkers.has(sessionId)) {
        await abortSession(sessionId);
        throw new WorkerCanceledError(sessionId);
      }
      started = true;
      result = await receipt.waitForCompletion();
      throwIfWorkerCanceled(sessionId);
    } catch (error) {
      if (cancelingWorkers.has(sessionId) || error instanceof WorkerCanceledError) {
        const canceled = new WorkerCanceledError(sessionId);
        if (!started || worker.ephemeral) return cleanUpFailedSpawn(sessionId, canceled);
        throw canceled;
      }
      if (!admitted) return cleanUpFailedSpawn(sessionId, error);
      admission.resolve(admitted);
      result = { status: "failed", error: error instanceof Error ? error.message : String(error) };
    }

    // Retention and cleanup are part of completion, but their failures are not execution outcomes.
    await applyRetention(sessionId, retention, result);
    return result;
  }
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

async function applyRetention(
  sessionId: string,
  retention: WorkerRetention,
  completion: SessionCompletion,
): Promise<void> {
  let retain = retention === "durable";
  if (typeof retention === "function") {
    const worker = await getPersistedWorker(sessionId);
    throwIfWorkerCanceled(sessionId);
    if (!worker) return;
    retain = await retention(worker, completion);
  }
  throwIfWorkerCanceled(sessionId);
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

function throwIfWorkerCanceled(sessionId: string): void {
  if (cancelingWorkers.has(sessionId)) throw new WorkerCanceledError(sessionId);
}

function releaseWorker(sessionId: string): void {
  activeWorkers.delete(sessionId);
  cancelingWorkers.delete(sessionId);
}
