// Artifact workers apply renderer-authored prompts to durable artifact files.
// This layer owns per-file admission and status; the runtime owns the worker.

import { stat } from "node:fs/promises";
import { AsyncQueuer } from "@tanstack/pacer/async-queuer";
import { resolveArtifactPath } from "@/functions/artifacts/paths";
import { sharedMap } from "@/functions/runtime/processState";
import { spawnWorker, stopWorker, WorkerStoppedError } from "@/functions/runtime/workers";
import {
  finishArtifactWorker,
  getArtifactWorker,
  hasArtifactWorker,
  startArtifactWorker,
} from "@/functions/state/workspace";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";
import type { JsonValue } from "@/types";

export type SpawnArtifactWorkerInput = {
  sessionId: string;
  path: string;
  name?: string;
  prompt: string;
  metadata?: JsonValue;
};

export type CancelArtifactWorkerInput = {
  sessionId: string;
  path: string;
  workerSessionId: string;
};

const artifactWorkerQueues = sharedMap<AsyncQueuer<() => Promise<void>>>("artifact-worker-queues");

export async function spawnArtifactWorker(
  input: SpawnArtifactWorkerInput,
): Promise<{ sessionId: string }> {
  const absolutePath = await resolveArtifactPath(input.sessionId, input.path);
  if (!absolutePath || !(await stat(absolutePath)).isFile()) {
    throw new Error("Invalid artifact path.");
  }

  const sessionId = `${SESSION_ID_PREFIX}${crypto.randomUUID()}`;
  startArtifactWorker({
    sessionId,
    sourceSessionId: input.sessionId,
    path: input.path,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  });
  enqueueArtifactWorker(absolutePath, sessionId, () =>
    executeArtifactWorker(input, absolutePath, sessionId),
  );
  return { sessionId };
}

/** Cancel one worker only when it belongs to the addressed artifact. */
export async function cancelArtifactWorker(input: CancelArtifactWorkerInput): Promise<boolean> {
  const worker = getArtifactWorker(input.workerSessionId);
  if (!worker || worker.sourceSessionId !== input.sessionId || worker.path !== input.path) {
    return false;
  }

  // Removing the association dequeues workers that have not reached the runtime
  // and immediately clears artifact-owned progress for workers being stopped.
  finishArtifactWorker(input.workerSessionId);
  await stopWorker(input.workerSessionId);
  return true;
}

async function executeArtifactWorker(
  input: SpawnArtifactWorkerInput,
  absolutePath: string,
  sessionId: string,
): Promise<void> {
  try {
    const worker = await spawnWorker({
      sessionId,
      parentSessionId: input.sessionId,
      ...(input.name === undefined ? {} : { name: input.name }),
      task: buildArtifactWorkerPrompt(input.prompt, absolutePath),
    });
    const completion = await worker.waitForCompletion();
    if (completion.status !== "completed") {
      throw new Error("The artifact worker did not complete.");
    }
  } catch (error) {
    if (!(error instanceof WorkerStoppedError)) throw error;
  } finally {
    finishArtifactWorker(sessionId);
  }
}

function enqueueArtifactWorker(
  absolutePath: string,
  sessionId: string,
  execute: () => Promise<void>,
): void {
  let queue = artifactWorkerQueues.get(absolutePath);
  if (!queue) {
    queue = new AsyncQueuer((run) => run(), {
      concurrency: 1,
      onError: (error) => console.error("Artifact worker failed:", error),
      onSettled: (_run, settledQueue) => {
        if (settledQueue.store.state.isIdle) artifactWorkerQueues.delete(absolutePath);
      },
    });
    artifactWorkerQueues.set(absolutePath, queue);
  }

  queue.addItem(async () => {
    if (hasArtifactWorker(sessionId)) await execute();
  });
}

export function buildArtifactWorkerPrompt(prompt: string, absolutePath: string): string {
  return `You are a focused background worker for an artifact. The artifact is ${absolutePath}.

Read that exact file immediately before acting and persist the substantive result there. Modify that file in place without creating a copy. Preserve unrelated content, inspect other files only when the task requires context, and do not leave the result only in your final response.

Task from the artifact renderer:
${prompt}`;
}
