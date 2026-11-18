// Server-only worker admission: validate untrusted owners, then spawn through
// the supervisor.

import type { CancelWorkerInput, SpawnWorkerInput, Worker } from "../model";
import { spawnWorker } from "./supervisor";
import { cancelWorker, getActiveWorker } from "./registry";
import { WorkerDatabase } from "./database";
import { getStateDatabase } from "@/server/database";
import { AppDatabase } from "@apps/server/database";
import { resolveWorkspaceFile } from "@files/server/paths";
import { workspaceFileId } from "@files/model";

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

  const db = await getStateDatabase();
  const apps = new AppDatabase(db);
  const app = await apps.get(input.appId);
  if (!app) throw new Error("Workers require an existing app.");
  const { sessionId } = await spawnWorker({
    ...details,
    owner: { type: "app", appId: app.id },
    retention: (input.ephemeral ?? true) ? "ephemeral" : "durable",
    message: {
      ...input.message,
      content: buildWorkerPrompt(input.message.content, { type: "app", app }),
    },
    // App deletion cancels only published workers, so recheck the app once this one is published.
    admit: async (worker) => {
      if (await apps.get(app.id)) return new WorkerDatabase(db).create(worker);
      throw new Error("The app was deleted before its worker started.");
    },
  });
  return { sessionId };
}

export async function cancelWorkerFromRequest(input: CancelWorkerInput): Promise<boolean> {
  if (!getRequestedWorker(input)) return false;
  return cancelWorker(input.workerSessionId);
}

function getRequestedWorker(input: CancelWorkerInput): Worker | undefined {
  const worker = getActiveWorker(input.workerSessionId);
  if (!worker || worker.type !== input.type) return;
  if (worker.type === "file" && input.type === "file") {
    return workspaceFileId(worker.file) === workspaceFileId(input.file) ? worker : undefined;
  }
  if (worker.type === "app" && input.type === "app") {
    return worker.appId === input.appId ? worker : undefined;
  }
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
