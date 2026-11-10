// Inbox dispatch, results, and retention over owned Workers.

import {
  deleteWorker,
  getWorker,
  hasWorker,
  initializeWorkerMetadata,
  listWorkers,
  spawnWorker,
  updateWorker,
} from "@workers/server";
import type { Worker } from "@workers/model";
import { broadcast } from "@workspace/server/events";
import type { SessionCompletion, SessionLaunch } from "@sessions/model";
import {
  inboxEntryFromWorker,
  inboxFailureSchema,
  inboxResultSchema,
  type InboxEntry,
} from "../model";

export async function listInboxEntries(): Promise<InboxEntry[]> {
  return (await listWorkers("inbox")).map((worker) =>
    inboxEntryFromWorker(worker, hasWorker(worker.sessionId)),
  );
}

export async function getInboxEntry(entryId: string): Promise<InboxEntry | null> {
  const worker = await getWorker(entryId, "inbox");
  return worker ? inboxEntryFromWorker(worker, hasWorker(entryId)) : null;
}

/** Accept an Inbox task without attaching a client to its Worker. */
export async function dispatchInboxTask(input: SessionLaunch): Promise<{ sessionId: string }> {
  const { sessionId } = await spawnWorker({
    ...input,
    owner: { type: "inbox" },
    retention: retainInboxResult,
  });
  broadcast({ type: "inbox.changed" });
  return { sessionId };
}

async function retainInboxResult(worker: Worker, completion: SessionCompletion): Promise<boolean> {
  if (completion.status === "completed") return worker.metadata !== undefined;

  await failInboxTask(
    worker.sessionId,
    completion.error
      ? `This task failed: ${completion.error}`.slice(0, 4000)
      : "This task stopped before reporting an Inbox result.",
  );
  return true;
}

export async function sendToInbox(
  sessionId: string,
  message: string,
  artifact?: string,
): Promise<void> {
  const result = inboxResultSchema.parse({
    message,
    ...(artifact === undefined ? {} : { artifact }),
  });
  await updateWorker(sessionId, { metadata: result });
  broadcast({ type: "inbox.changed" });
}

/** A reported or unreadable result wins over failure of its supervising run. */
export async function failInboxTask(sessionId: string, error: string): Promise<void> {
  const failure = inboxFailureSchema.parse({ error });
  if (await initializeWorkerMetadata(sessionId, "inbox", failure)) {
    broadcast({ type: "inbox.changed" });
  }
}

export function deleteInboxEntry(entryId: string): Promise<boolean> {
  return deleteWorker(entryId, "inbox");
}
