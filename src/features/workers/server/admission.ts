// Server-only worker admission: validate the owner, register the pending worker,
// and hand execution to the runtime supervisor.

import type { CancelWorkerInput, SpawnWorkerInput, Worker } from "../model";
import {
  registerPendingSessionCompletion,
  rejectPendingSessionCompletion,
} from "@sessions/server/runtime";
import * as supervisor from "./supervisor";
import { WorkerCanceledError } from "./supervisor";
import { finishWorker, getWorker, hasWorker, startWorker } from "./registry";
import { getStateDatabase } from "@/server/database";
import { AppDatabase } from "@apps/server/database";
import { resolveWorkspaceFile } from "@files/server/paths";
import { workspaceFileId } from "@files/model";
import { SESSION_ID_PREFIX } from "@sessions/model/constants";
import type { SessionCompletion } from "@sessions/model";

export async function spawnWorker(input: SpawnWorkerInput): Promise<{ sessionId: string }> {
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
  startWorker(worker);
  const receipt = registerPendingSessionCompletion(worker.sessionId);
  void executeAdmittedWorker(worker.sessionId, receipt, execute).catch(reportWorkerError);
}

export async function cancelWorker(input: CancelWorkerInput): Promise<boolean> {
  if (!getRequestedWorker(input)) return false;

  // Clear owner progress immediately, including while the supervisor is still
  // preparing the worker's runtime.
  finishWorker(input.workerSessionId);
  rejectWorkerCompletion(input.workerSessionId);
  await supervisor.cancelWorker(input.workerSessionId);
  return true;
}

async function executeWorker(
  input: SpawnWorkerInput,
  message: SpawnWorkerInput["message"],
  worker: Worker,
): Promise<SessionCompletion> {
  if (!hasWorker(worker.sessionId)) throw new WorkerCanceledError(worker.sessionId);
  const receipt = await supervisor.spawnWorker({
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
    finishWorker(sessionId);
  }
}

function reportWorkerError(error: unknown): void {
  console.error("Worker failed:", error);
}

function getRequestedWorker(input: CancelWorkerInput): Worker | undefined {
  const worker = getWorker(input.workerSessionId);
  if (!worker || worker.type !== input.type) return;
  if (worker.type === "file" && input.type === "file") {
    return workspaceFileId(worker.file) === workspaceFileId(input.file) ? worker : undefined;
  }
  if (worker.type === "app" && input.type === "app") {
    return worker.appId === input.appId ? worker : undefined;
  }
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

Read that exact file immediately before acting and persist the substantive result there. Modify that file in place without creating a copy. Other workers or the user may edit the file concurrently, so reread it immediately before every write, merge your intended change into the latest contents, and never overwrite unrelated intervening changes. Preserve unrelated content, inspect other files only when the task requires context, and do not leave the result only in your final response.

Task from the editor:
${prompt}`;
}
