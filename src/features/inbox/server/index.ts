// Inbox results and retention over owned Workers.

import {
  deleteWorker,
  getWorker,
  initializeWorkerMetadata,
  listWorkers,
  updateWorker,
} from "@workers/server";
import { broadcast } from "@workspace/server/events";
import { sharedMap } from "@/shared/server/processState";
import {
  inboxEntryFromWorker,
  inboxFailureSchema,
  inboxResultSchema,
  type InboxEntry,
} from "../model";

const recovery = sharedMap<Promise<void>>("inbox-recovery");

export async function listInboxEntries(): Promise<InboxEntry[]> {
  await ensureInboxRecovered();
  return (await listWorkers("inbox")).map(inboxEntryFromWorker);
}

export async function getInboxEntry(entryId: string): Promise<InboxEntry | null> {
  const worker = await getWorker(entryId, "inbox");
  return worker ? inboxEntryFromWorker(worker) : null;
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

/** Finish recovery before accepting new work or serving the first snapshot. */
export function ensureInboxRecovered(): Promise<void> {
  const existing = recovery.get("startup");
  if (existing) return existing;
  const pending = recoverInbox().catch((error) => {
    recovery.delete("startup");
    throw error;
  });
  recovery.set("startup", pending);
  return pending;
}

async function recoverInbox(): Promise<void> {
  // Admission awaits this same recovery, so these Workers belong to an earlier process.
  for (const worker of await listWorkers("inbox")) {
    if (worker.metadata === undefined) {
      await failInboxTask(
        worker.sessionId,
        "This task was interrupted before Inbox recorded its outcome. Some work may already have completed.",
      );
    }
  }
}
