import { expect, mock, onTestFinished, test } from "bun:test";
import type { Database } from "db0";
import { createTestDatabase } from "@/functions/state/database";

let currentDb: Database | undefined;

mock.module("@/functions/state/database", () => ({
  getAppDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const { completeInboxEntry, createInboxEntry, deleteInboxArtifact } =
  await import("@/functions/state/workspace/inbox");
const { resolveArtifactPath } = await import("@/functions/artifacts/paths");
const { resolveArtifactRequest } = await import("./artifactRequest");

async function openArtifactRequestTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.dispose();
    currentDb = undefined;
  });
}

test("artifact routes derive Inbox storage from the source session", async () => {
  await openArtifactRequestTestDatabase();
  const entryId = `toy-box-${crypto.randomUUID()}`;
  await createInboxEntry(entryId);
  const entry = await completeInboxEntry(entryId, "Result ready", {
    filename: "result.md",
    content: "# Result",
  });
  onTestFinished(() => deleteInboxArtifact(entryId));

  const result = await resolveArtifactRequest(entryId, entry.artifact);

  expect(result.error).toBeNull();
  expect(result.absolutePath).toEndWith(`/.toy-box/inbox/${entryId}/${entry.artifact}`);
});

test("artifact routes reject paths not owned by an Inbox entry", async () => {
  await openArtifactRequestTestDatabase();
  const entryId = `toy-box-${crypto.randomUUID()}`;
  await createInboxEntry(entryId);
  await completeInboxEntry(entryId, "Result ready", {
    filename: "result.md",
    content: "# Result",
  });
  onTestFinished(() => deleteInboxArtifact(entryId));

  const otherFile = await resolveArtifactRequest(entryId, "other.md");
  const traversal = await resolveArtifactRequest(entryId, "../outside.md");

  expect(otherFile.absolutePath).toBe("");
  expect(otherFile.error?.status).toBe(403);
  expect(traversal.absolutePath).toBe("");
  expect(traversal.error?.status).toBe(403);
});

test("ordinary artifacts resolve beneath their source session files", async () => {
  const result = await resolveArtifactPath("toy-box-session", "nested/report.md");

  expect(result).toEndWith("/.copilot/session-state/toy-box-session/files/nested/report.md");
});
