import { expect, onTestFinished, spyOn, test } from "bun:test";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import * as state from "@/server/database";
import * as sessionRuntime from "@sessions/server/runtime";
import { deleteSessionState } from "@workspace/server/state/sessions";
import type { WorkspaceEvent } from "@workspace/model/events";
import * as database from "./database";
import { createPendingInboxEntry, deleteInboxEntry, listInboxEntries, sendToInbox } from "./index";

test("entry lifecycle publishes the state-bearing Inbox transitions", async () => {
  const db = await state.createTestDatabase();
  const readDatabase = spyOn(state, "getStateDatabase").mockResolvedValue(db);
  const deleteSession = spyOn(sessionRuntime, "deleteSessionIfExists").mockResolvedValue(false);
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
    readDatabase.mockRestore();
    deleteSession.mockRestore();
    await db.close();
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
