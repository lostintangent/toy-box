// Server-only worker admission: validate the owner, register the pending worker,
// apply owner-specific scheduling, and hand execution to the runtime supervisor.

import { AsyncQueuer } from "@tanstack/pacer/async-queuer";
import {
  registerPendingSessionCompletion,
  rejectPendingSessionCompletion,
} from "@/functions/runtime/stream";
import { cancelWorker, spawnWorker as runWorker, WorkerCanceledError } from "./supervisor";
import { sharedMap } from "@/functions/runtime/processState";
import {
  finishWorker as finishWorkerState,
  getWorker,
  hasWorker,
  startWorker as startWorkerState,
} from "@/functions/state/workspace";
import { getStateDatabase } from "@/functions/state/database";
import { AppDatabase } from "@/functions/apps/state/database";
import { resolveWorkspaceFile } from "@/lib/server/filePaths";
import { workspaceFileId } from "@/lib/files/workspaceFile";
import { workerOwnerId } from "@/lib/workers";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";
import type { SessionCompletion, SessionLaunch, Worker } from "@/types";

type SpawnWorkerRequest = SessionLaunch &
  (
    | Omit<Extract<Worker, { type: "file" }>, "sessionId" | "ephemeral">
    | (Omit<Extract<Worker, { type: "app" }>, "sessionId" | "ephemeral"> & {
        ephemeral?: boolean;
      })
  );

type WorkerAddress = { workerSessionId: string } & (
  | Pick<Extract<Worker, { type: "file" }>, "type" | "file">
  | Pick<Extract<Worker, { type: "app" }>, "type" | "appId">
);

const workerQueues = sharedMap<AsyncQueuer<() => Promise<void>>>("worker-queues");

export async function spawnWorkerOnServer(
  input: SpawnWorkerRequest,
): Promise<{ sessionId: string }> {
  const sessionId = `${SESSION_ID_PREFIX}${crypto.randomUUID()}`;
  const details = {
    sessionId,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };

  if (input.type === "file") {
    const absolutePath = resolveWorkspaceFile(input.file);
    if (!absolutePath || !(await Bun.file(absolutePath).stat()).isFile()) {
      throw new Error("Invalid file path.");
    }
    const worker: Worker = { ...details, type: "file", file: input.file, ephemeral: true };
    admitWorker(worker, () =>
      executeWorker(
        input,
        {
          ...input.message,
          content: buildWorkerPrompt(input.message.content, {
            type: "file",
            absolutePath,
          }),
        },
        worker,
      ),
    );
  } else {
    const apps = new AppDatabase(await getStateDatabase());
    if (!(await apps.get(input.appId))) throw new Error("Workers require an existing app.");
    const worker: Worker = {
      ...details,
      type: "app",
      appId: input.appId,
      ephemeral: input.ephemeral ?? true,
    };
    admitWorker(worker, async () => {
      const app = await apps.get(input.appId);
      if (!app) throw new Error("The app was deleted before its worker started.");
      return executeWorker(
        input,
        {
          ...input.message,
          content: buildWorkerPrompt(input.message.content, { type: "app", app }),
        },
        worker,
      );
    });
  }

  return { sessionId };
}

function admitWorker(worker: Worker, execute: () => Promise<SessionCompletion>): void {
  startWorkerState(worker);
  const receipt = registerPendingSessionCompletion(worker.sessionId);
  const run = () => executeAdmittedWorker(worker.sessionId, receipt, execute);
  if (worker.type === "file") enqueueWorker(workerOwnerId(worker), worker.sessionId, run);
  else void run().catch(reportWorkerError);
}

export async function cancelWorkerOnServer(input: WorkerAddress): Promise<boolean> {
  if (!getRequestedWorker(input)) return false;

  // Removing the registration dequeues workers that have not reached the runtime
  // and immediately clears owner progress for workers being canceled.
  finishWorkerState(input.workerSessionId);
  rejectWorkerCompletion(input.workerSessionId);
  await cancelWorker(input.workerSessionId);
  return true;
}

async function executeWorker(
  input: SpawnWorkerRequest,
  message: SessionLaunch["message"],
  worker: Worker,
): Promise<SessionCompletion> {
  if (!hasWorker(worker.sessionId)) throw new WorkerCanceledError(worker.sessionId);
  const receipt = await runWorker({
    worker,
    message,
    directory: input.directory,
    useWorktree: input.useWorktree,
  });
  return receipt.waitForCompletion();
}

async function executeAdmittedWorker(
  sessionId: string,
  receipt: ReturnType<typeof registerPendingSessionCompletion>,
  execute: () => Promise<SessionCompletion>,
): Promise<void> {
  try {
    const completion = await execute();
    receipt.resolve(completion);
    if (completion.status !== "completed") {
      throw new Error("The worker did not complete.");
    }
  } catch (error) {
    receipt.reject(error);
    if (!(error instanceof WorkerCanceledError)) throw error;
  } finally {
    finishWorkerState(sessionId);
  }
}

function enqueueWorker(queueKey: string, sessionId: string, execute: () => Promise<void>): void {
  let queue = workerQueues.get(queueKey);
  if (!queue) {
    queue = new AsyncQueuer((run) => run(), {
      concurrency: 1,
      onError: reportWorkerError,
      onSettled: (_run, settledQueue) => {
        if (settledQueue.store.state.isIdle) workerQueues.delete(queueKey);
      },
    });
    workerQueues.set(queueKey, queue);
  }

  queue.addItem(async () => {
    if (hasWorker(sessionId)) await execute();
    else rejectWorkerCompletion(sessionId);
  });
}

function reportWorkerError(error: unknown): void {
  console.error("Worker failed:", error);
}

function getRequestedWorker(input: WorkerAddress): Worker | undefined {
  const worker = getWorker(input.workerSessionId);
  if (!worker || worker.type !== input.type) return;
  if (worker.type === "file" && input.type === "file") {
    return workspaceFileId(worker.file) === workspaceFileId(input.file) ? worker : undefined;
  }
  if (worker.type === "app" && input.type === "app") {
    return worker.appId === input.appId ? worker : undefined;
  }
  return;
}

function rejectWorkerCompletion(sessionId: string): void {
  rejectPendingSessionCompletion(sessionId, new WorkerCanceledError(sessionId));
}

export function buildWorkerPrompt(
  prompt: string,
  owner:
    | { type: "file"; absolutePath: string }
    | {
        type: "app";
        app: { id: string; title: string };
      },
): string {
  if (owner.type === "app") {
    return `You are a background worker owned by the Toy Box app "${owner.app.title}".

The app instance ID is "${owner.app.id}". The get_app and update_app tools are scoped to this owning app, so do not pass an app ID to either one.

Complete the app task below. Before state-dependent work, call get_app for the latest state, schema, and revision. When the task calls for a durable app-state change, persist the complete next state by calling update_app with that revision. If update_app reports a conflict, apply the intended change to the returned current state and retry with its revision. When the task asks only for a result, return it in your final response without reading or writing state merely to carry that response.

Task from the app:
${prompt}`;
  }

  return `You are a focused background worker for a file. The file is ${owner.absolutePath}.

Read that exact file immediately before acting and persist the substantive result there. Modify that file in place without creating a copy. Preserve unrelated content, inspect other files only when the task requires context, and do not leave the result only in your final response.

Task from the editor:
${prompt}`;
}
