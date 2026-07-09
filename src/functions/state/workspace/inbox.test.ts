import { expect, mock, onTestFinished, test } from "bun:test";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { Database } from "db0";
import { createTestDatabase } from "../database";

let currentDb: Database | undefined;

mock.module("../database", () => ({
  getAppDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const {
  completeInboxEntry,
  createInboxEntry,
  deleteInboxArtifact,
  deleteInboxEntryState,
  getInboxEntries,
  hasInboxEntry,
  resolveInboxArtifactPath,
} = await import("./inbox");

async function openInboxTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.dispose();
    currentDb = undefined;
  });
}

test("an inbox entry is created pending and completed with its optional artifact", async () => {
  await openInboxTestDatabase();
  const entryId = `toy-box-${crypto.randomUUID()}`;
  const pending = await createInboxEntry(entryId);
  const entry = await completeInboxEntry(entryId, "Report ready", {
    filename: "report.md",
    content: "first version",
  });
  const artifactFilename = entry.artifact!;
  const artifactPath = resolveInboxArtifactPath(entryId, artifactFilename)!;
  onTestFinished(() => deleteInboxArtifact(entryId));

  expect(pending).toEqual({
    id: entryId,
    createdAt: expect.any(String),
  });
  expect(entry).toEqual({
    ...pending,
    message: "Report ready",
    artifact: "report.md",
  });
  expect(await readFile(artifactPath, "utf-8")).toBe("first version");

  expect(await deleteInboxEntryState(entry.id)).toBe(true);
  expect(await artifactExists(entryId, artifactFilename)).toBe(false);
  expect(await hasInboxEntry(entry.id)).toBe(false);
});

test("an inbox entry can be completed with only its concise message", async () => {
  await openInboxTestDatabase();
  const entryId = `toy-box-${crypto.randomUUID()}`;
  const pending = await createInboxEntry(entryId);
  const entry = await completeInboxEntry(entryId, "Done");

  expect(entry).toEqual({ ...pending, message: "Done" });
  expect(await getInboxEntries()).toEqual([entry]);
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

test("inbox artifact paths stay within one entry directory", async () => {
  await openInboxTestDatabase();
  expect(resolveInboxArtifactPath("../outside", "report.md")).toBeNull();
  expect(resolveInboxArtifactPath("entry", "nested/outside.md")).toBeNull();
  expect(resolveInboxArtifactPath("/tmp/outside", "report.md")).toBeNull();
  expect(resolveInboxArtifactPath(String.raw`folder\outside`, "report.md")).toBeNull();

  const entryId = `toy-box-${crypto.randomUUID()}`;
  await createInboxEntry(entryId);
  expect(
    completeInboxEntry(entryId, "Unsafe", {
      filename: "../outside.md",
      content: "nope",
    }),
  ).rejects.toThrow();
  expect((await getInboxEntries()).find((entry) => entry.id === entryId)?.message).toBeUndefined();
});

test("artifact storage failure leaves the inbox entry pending", async () => {
  await openInboxTestDatabase();
  const entryId = `toy-box-${crypto.randomUUID()}`;
  const absolutePath = resolveInboxArtifactPath(entryId, "reserved.md")!;
  await mkdir(dirname(absolutePath), { recursive: true });
  await createInboxEntry(entryId);
  onTestFinished(() => deleteInboxArtifact(entryId));

  expect(
    completeInboxEntry(entryId, "Will fail", {
      filename: "result.md",
      content: "Result",
    }),
  ).rejects.toThrow();
  expect((await getInboxEntries()).find((entry) => entry.id === entryId)?.message).toBeUndefined();
});

async function artifactExists(entryId: string, filename: string): Promise<boolean> {
  const path = resolveInboxArtifactPath(entryId, filename);
  if (!path) return false;
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
