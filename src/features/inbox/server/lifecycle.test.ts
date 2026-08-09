import { expect, mock, onTestFinished, test } from "bun:test";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { createTestDatabase } from "@/server/database";
import { deleteSessionState } from "@workspace/server/state/sessions";
import type { WorkspaceEvent } from "@workspace/model/events";

let currentDb: Bun.SQL | undefined;

mock.module("@/server/database", () => ({
  getStateDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));
mock.module("@sessions/server/runtime", () => ({
  deleteSessionIfExists: async () => false,
}));

const database = await import("./database");
const { createPendingInboxEntry, deleteInboxEntry, listInboxEntries, sendToInbox } =
  await import("./index");

test("entry lifecycle publishes the state-bearing Inbox transitions", async () => {
  currentDb = await createTestDatabase();
  const sessionId = `toy-box-${crypto.randomUUID()}`;
  const events: WorkspaceEvent[] = [];
  const unsubscribe = subscribeWorkspaceEvents((event) => {
    if (event.type === "inbox.entry.upserted" && event.entry.id === sessionId) events.push(event);
    if (event.type === "inbox.entry.deleted" && event.entryId === sessionId) events.push(event);
  });
  onTestFinished(async () => {
    unsubscribe();
    deleteSessionState(sessionId);
    await database.deleteInboxEntry(sessionId);
    await currentDb?.close();
    currentDb = undefined;
  });

  const pending = await createPendingInboxEntry(sessionId);
  const completed = await sendToInbox(sessionId, "Report ready", "report.md");
  await deleteInboxEntry(sessionId);
  await deleteInboxEntry(sessionId);

  expect(await listInboxEntries()).toEqual([]);
  expect(events).toEqual([
    { type: "inbox.entry.upserted", entry: pending },
    { type: "inbox.entry.upserted", entry: completed },
    { type: "inbox.entry.deleted", entryId: sessionId },
  ]);
});
