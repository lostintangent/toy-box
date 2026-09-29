// Server-only worker admission: validate the owner, register the pending worker,
// and hand execution to the runtime supervisor.

import type { CancelWorkerInput, SpawnWorkerInput, Worker, WorkerOwner } from "../model";
import {
  registerPendingSessionCompletion,
  rejectPendingSessionCompletion,
} from "@sessions/server/runtime";
import * as supervisor from "./supervisor";
import { WorkerCanceledError } from "./supervisor";
import type { WorkerReceipt, WorkerRetention } from "./supervisor";
import { finishWorker, getWorker, hasWorker, startWorker } from "./registry";
import { createWorker } from "./database";
import { getStateDatabase } from "@/server/database";
import { AppDatabase } from "@apps/server/database";
import { resolveWorkspaceFile } from "@files/server/paths";
import { workspaceFileId } from "@files/model";
import type { SessionLaunch } from "@sessions/model";

type SessionWorkerInput = SessionLaunch & {
  parentSessionId: string;
  name?: Worker["name"];
  ephemeral?: boolean;
};

export type WorkerSpawn<Owner extends WorkerOwner = WorkerOwner, Value = void> = SessionLaunch &
  Pick<Worker, "name"> & {
    metadata?: unknown;
    owner: Owner;
    sessionId?: string;
    retention: WorkerRetention;
    /** Persist ownership with an owner-specific admission, before execution starts. */
    admit?: (worker: Worker & Owner) => Promise<Value>;
  };

export async function spawnWorkerFromRequest(
  input: SpawnWorkerInput,
): Promise<{ sessionId: string }> {
  const details = {
    location: input.location,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };

  if (input.type === "file") {
    const absolutePath = resolveWorkspaceFile(input.file);
    if (!absolutePath || !(await Bun.file(absolutePath).stat()).isFile()) {
      throw new Error("Invalid file path.");
    }
    const { sessionId } = await spawnWorker({
      ...details,
      owner: { type: "file", file: input.file },
      retention: "ephemeral",
      message: {
        ...input.message,
        content: buildWorkerPrompt(input.message.content, { type: "file", absolutePath }),
      },
    });
    return { sessionId };
  }

  const apps = new AppDatabase(await getStateDatabase());
  if (!(await apps.get(input.appId))) throw new Error("Workers require an existing app.");
  const request: WorkerSpawn = {
    ...details,
    owner: { type: "app", appId: input.appId },
    retention: (input.ephemeral ?? true) ? "ephemeral" : "durable",
    message: input.message,
  };
  const { sessionId } = await admitWorker(request, async (worker) => {
    const app = await apps.get(input.appId);
    if (!app) throw new Error("The app was deleted before its worker started.");
    return superviseAdmittedWorker({
      worker,
      retention: request.retention,
      location: input.location,
      message: {
        ...input.message,
        content: buildWorkerPrompt(input.message.content, { type: "app", app }),
      },
    });
  });
  return { sessionId };
}

/** Spawn a worker whose trusted owner is injected by the invoking session tool. */
export async function spawnSessionWorker(
  input: SessionWorkerInput,
): Promise<{ sessionId: string }> {
  const { sessionId } = await spawnWorker({
    owner: { type: "session", parentSessionId: input.parentSessionId },
    retention: input.ephemeral ? "ephemeral" : "durable",
    ...(input.name === undefined ? {} : { name: input.name }),
    message: input.message,
    location: input.location,
  });
  return { sessionId };
}

/** Start trusted owner-supplied work through the same admission and completion lifecycle. */
export function spawnWorker<Owner extends WorkerOwner, Value>(
  input: WorkerSpawn<Owner, Value> & Required<Pick<WorkerSpawn<Owner, Value>, "admit">>,
): Promise<WorkerReceipt<Value>>;
export function spawnWorker(input: WorkerSpawn): Promise<WorkerReceipt>;
export function spawnWorker<Owner extends WorkerOwner, Value>(
  input: WorkerSpawn<Owner, Value>,
): Promise<WorkerReceipt<Value | void>> {
  const { admit } = input;
  return admitWorker(input, (worker) =>
    superviseAdmittedWorker({
      worker,
      message: input.message,
      location: input.location,
      retention: input.retention,
      admit: admit ? () => admit(worker) : undefined,
    }),
  );
}

function admitWorker<Owner extends WorkerOwner, Value>(
  input: WorkerSpawn<Owner, Value>,
  spawn: (worker: Worker & Owner) => Promise<WorkerReceipt<Value>>,
): Promise<WorkerReceipt<Value>> {
  const worker = createWorker(
    {
      ...input.owner,
      ephemeral: input.retention === "ephemeral",
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    },
    input.sessionId,
  );
  const receipt = registerPendingSessionCompletion(worker.sessionId);
  // Publish only after waiting by ID is safe. Workspace observers can react
  // synchronously to worker.started before the backing Session exists.
  startWorker(worker);
  const workerSession = spawn(worker);
  void completeAdmittedWorker(worker.sessionId, receipt, workerSession).catch(reportWorkerError);
  return workerSession;
}

export async function cancelWorker(input: CancelWorkerInput): Promise<boolean> {
  if (!getRequestedWorker(input)) return false;

  await cancelAdmittedWorker(input.workerSessionId);
  return true;
}

/** Cancel trusted work after its owner has already been resolved. */
export async function cancelAdmittedWorker(sessionId: string): Promise<boolean> {
  // Clear owner progress immediately, including while the supervisor is still
  // preparing the worker's runtime.
  finishWorker(sessionId);
  rejectWorkerCompletion(sessionId);
  return supervisor.cancelWorker(sessionId);
}

function superviseAdmittedWorker<Value>(
  input: Parameters<typeof supervisor.superviseWorker<Value>>[0],
): Promise<WorkerReceipt<Value | void>> {
  if (!hasWorker(input.worker.sessionId)) {
    return Promise.reject(new WorkerCanceledError(input.worker.sessionId));
  }
  return supervisor.superviseWorker(input);
}

async function completeAdmittedWorker(
  sessionId: string,
  receipt: ReturnType<typeof registerPendingSessionCompletion>,
  workerSession: Promise<WorkerReceipt<unknown>>,
): Promise<void> {
  try {
    const completion = await (await workerSession).waitForCompletion();
    receipt.resolve(completion);
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
