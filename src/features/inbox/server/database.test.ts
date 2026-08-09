import { expect, mock, onTestFinished, test } from "bun:test";
import { createTestDatabase } from "@/server/database";

let currentDb: Bun.SQL | undefined;

mock.module("@/server/database", () => ({
  getStateDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const { completeInboxEntry, createInboxEntry, deleteInboxEntry, listInboxEntries, hasInboxEntry } =
  await import("./database");

async function openInboxTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
  });
}

test("an inbox entry is created pending and completed with its optional artifact filename", async () => {
  await openInboxTestDatabase();
  const entryId = `toy-box-${crypto.randomUUID()}`;
  const pending = await createInboxEntry(entryId);
  const entry = await completeInboxEntry(entryId, "Report ready", "report.md");

  expect(pending).toEqual({ id: entryId, createdAt: expect.any(String) });
  expect(entry).toEqual({ ...pending, message: "Report ready", artifact: "report.md" });

  expect(await deleteInboxEntry(entry.id)).toBe(true);
  expect(await hasInboxEntry(entry.id)).toBe(false);
});

test("an inbox entry can be completed with only its concise message", async () => {
  await openInboxTestDatabase();
  const entryId = `toy-box-${crypto.randomUUID()}`;
  const pending = await createInboxEntry(entryId);
  const entry = await completeInboxEntry(entryId, "Done");

  expect(entry).toEqual({ ...pending, message: "Done" });
  expect(await listInboxEntries()).toEqual([entry]);
});

test("an inbox entry can only be completed once", async () => {
  await openInboxTestDatabase();
  const entryId = `toy-box-${crypto.randomUUID()}`;
  await createInboxEntry(entryId);
  await completeInboxEntry(entryId, "First result");

  expect(completeInboxEntry(entryId, "Second result")).rejects.toThrow(
    "Inbox entry already completed.",
  );
});

test("an inbox entry rejects an unsafe artifact filename", async () => {
  await openInboxTestDatabase();
  const entryId = `toy-box-${crypto.randomUUID()}`;
  await createInboxEntry(entryId);

  expect(completeInboxEntry(entryId, "Unsafe", "../outside.md")).rejects.toThrow();
  expect((await listInboxEntries()).find((entry) => entry.id === entryId)?.message).toBeUndefined();
});
