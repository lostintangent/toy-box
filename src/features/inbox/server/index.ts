// Inbox entry lifecycle behind the validated public operations.

import { broadcast } from "@workspace/server/events";
import { deleteSessionIfExists } from "@sessions/server/runtime";
import { setSessionStatus } from "@workspace/server/state";
import type { InboxEntry } from "../model";
import * as entries from "./database";

export { getInboxEntry, listInboxEntries } from "./database";

export async function createPendingInboxEntry(sessionId: string): Promise<InboxEntry> {
  const entry = await entries.createInboxEntry(sessionId);
  setSessionStatus(sessionId, "running");
  broadcast({ type: "inbox.entry.upserted", entry });
  return entry;
}

export async function sendToInbox(
  sessionId: string,
  message: string,
  artifactFilename?: string,
): Promise<InboxEntry> {
  const entry = await entries.completeInboxEntry(sessionId, message, artifactFilename);
  broadcast({ type: "inbox.entry.upserted", entry });
  return entry;
}

export async function deleteInboxEntry(entryId: string): Promise<boolean> {
  if (!(await entries.hasInboxEntry(entryId))) return false;
  await deleteSessionIfExists(entryId);

  const deleted = await entries.deleteInboxEntry(entryId);
  if (deleted) broadcast({ type: "inbox.entry.deleted", entryId });
  return deleted;
}
