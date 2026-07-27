// Server-only worker admission: resolve the file, register the pending worker,
// serialize per file, and hand execution to the runtime supervisor. Kept out of
// the RPC module (`../workers.ts`) so its Node/SDK imports never reach the client
// bundle — it is imported only from within `createServerFn` handlers.

import { AsyncQueuer } from "@tanstack/pacer/async-queuer";
import {
  spawnWorker as runWorker,
  stopWorker,
  WorkerStoppedError,
} from "@/functions/runtime/workers";
import { sharedMap } from "@/functions/runtime/processState";
import {
  finishWorker as finishWorkerState,
  getWorker,
  hasWorker,
  startWorker as startWorkerState,
} from "@/functions/state/workspace";
import { resolveWorkspaceFile } from "@/lib/server/filePaths";
import { ownerSessionId, workspaceFileId } from "@/lib/files/workspaceFile";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";
import type { JsonValue, WorkspaceFile } from "@/types";

export type SpawnWorkerRequest = {
  file: WorkspaceFile;
  name?: string;
  prompt: string;
  metadata?: JsonValue;
};

export type CancelWorkerRequest = {
  file: WorkspaceFile;
  workerSessionId: string;
};

const workerQueues = sharedMap<AsyncQueuer<() => Promise<void>>>("worker-queues");

export async function spawnWorkerOnServer(
  input: SpawnWorkerRequest,
): Promise<{ sessionId: string }> {
  // Only a session-owned file can parent a worker; a machine file has no owner.
  const owner = ownerSessionId(input.file);
  if (!owner) throw new Error("Workers require a session-owned file.");

  const absolutePath = resolveWorkspaceFile(input.file);
  const { stat } = await import("node:fs/promises");
  if (!absolutePath || !(await stat(absolutePath)).isFile()) {
    throw new Error("Invalid file path.");
  }

  const sessionId = `${SESSION_ID_PREFIX}${crypto.randomUUID()}`;
  startWorkerState({
    sessionId,
    file: input.file,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  });
  enqueueWorker(workspaceFileId(input.file), sessionId, () =>
    executeWorker(input, absolutePath, owner, sessionId),
  );
  return { sessionId };
}

export async function cancelWorkerOnServer(input: CancelWorkerRequest): Promise<boolean> {
  const worker = getWorker(input.workerSessionId);
  if (!worker?.file || workspaceFileId(worker.file) !== workspaceFileId(input.file)) {
    return false;
  }

  // Removing the registration dequeues workers that have not reached the runtime
  // and immediately clears file-owned progress for workers being stopped.
  finishWorkerState(input.workerSessionId);
  await stopWorker(input.workerSessionId);
  return true;
}

async function executeWorker(
  input: SpawnWorkerRequest,
  absolutePath: string,
  parentSessionId: string,
  sessionId: string,
): Promise<void> {
  try {
    const worker = await runWorker({
      sessionId,
      parentSessionId,
      ...(input.name === undefined ? {} : { name: input.name }),
      task: buildWorkerPrompt(input.prompt, absolutePath),
    });
    const completion = await worker.waitForCompletion();
    if (completion.status !== "completed") {
      throw new Error("The worker did not complete.");
    }
  } catch (error) {
    if (!(error instanceof WorkerStoppedError)) throw error;
  } finally {
    finishWorkerState(sessionId);
  }
}

function enqueueWorker(queueKey: string, sessionId: string, execute: () => Promise<void>): void {
  let queue = workerQueues.get(queueKey);
  if (!queue) {
    queue = new AsyncQueuer((run) => run(), {
      concurrency: 1,
      onError: (error) => console.error("Worker failed:", error),
      onSettled: (_run, settledQueue) => {
        if (settledQueue.store.state.isIdle) workerQueues.delete(queueKey);
      },
    });
    workerQueues.set(queueKey, queue);
  }

  queue.addItem(async () => {
    if (hasWorker(sessionId)) await execute();
  });
}

export function buildWorkerPrompt(prompt: string, absolutePath: string): string {
  return `You are a focused background worker for a file. The file is ${absolutePath}.

Read that exact file immediately before acting and persist the substantive result there. Modify that file in place without creating a copy. Preserve unrelated content, inspect other files only when the task requires context, and do not leave the result only in your final response.

Task from the editor:
${prompt}`;
}
