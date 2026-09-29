import { utimes } from "node:fs/promises";
import { resolveSessionArtifactPath } from "@files/server/paths";
import { deleteSessionFiles } from "@sessions/server/artifacts";
import { expect, mock, onTestFinished, test } from "bun:test";
import type { ToolInvocation } from "@github/copilot-sdk";
import { createTestDatabase } from "@/server/database";

let currentDb: Bun.SQL | undefined;

mock.module("@/server/database", () => ({
  getStateDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const { WorkerDatabase } = await import("@workers/server/database");
const { ensureInboxRecovered, getInboxEntry } = await import("./index");
const { inboxTools } = await import("./tools");

async function openInboxToolTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  await ensureInboxRecovered();
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
  });
}

function invocation(sessionId: string): ToolInvocation {
  return {
    sessionId,
    toolCallId: "tool-call",
    toolName: "send_to_inbox",
    arguments: {},
  };
}

function createInboxWorker(sessionId: string) {
  return new WorkerDatabase(currentDb!).create({
    type: "inbox",
    sessionId,
    createdAt: new Date(0).toISOString(),
    ephemeral: false,
  });
}

test("send_to_inbox attaches an existing nested file without rewriting it, and can clear its reference", async () => {
  await openInboxToolTestDatabase();
  const sessionId = `toy-box-${crypto.randomUUID()}`;
  await createInboxWorker(sessionId);
  const artifact = "reports/research.md";
  const path = resolveSessionArtifactPath(sessionId, artifact)!;
  await Bun.write(path, "# Research");
  onTestFinished(() => deleteSessionFiles(sessionId));
  await utimes(path, 0, 0);

  const [sendToInbox] = inboxTools;
  expect(sendToInbox.isTerminal).toBe(true);
  const result = await sendToInbox.handler(
    { message: "Research is ready", artifact },
    invocation(sessionId),
  );
  expect(JSON.parse(String(result))).toEqual({ entryId: sessionId });
  expect(await Bun.file(path).text()).toBe("# Research");
  expect(Bun.file(path).lastModified).toBe(0);
  expect(await getInboxEntry(sessionId)).toEqual({
    id: sessionId,
    createdAt: new Date(0).toISOString(),
    kind: "result",
    message: "Research is ready",
    artifact,
  });

  await sendToInbox.handler({ message: "Updated answer" }, invocation(sessionId));
  expect(await getInboxEntry(sessionId)).toEqual({
    id: sessionId,
    createdAt: new Date(0).toISOString(),
    kind: "result",
    message: "Updated answer",
  });
  expect(await Bun.file(path).text()).toBe("# Research");
});

test("send_to_inbox rejects invalid artifacts without replacing the existing result", async () => {
  await openInboxToolTestDatabase();
  const sessionId = `toy-box-${crypto.randomUUID()}`;
  await createInboxWorker(sessionId);
  await Bun.write(resolveSessionArtifactPath(sessionId, "reports/result.md")!, "Result");
  onTestFinished(() => deleteSessionFiles(sessionId));
  const [sendToInbox] = inboxTools;
  await sendToInbox.handler({ message: "Keep this answer" }, invocation(sessionId));
  const existing = await getInboxEntry(sessionId);
  for (const artifact of ["missing.md", "reports", "../outside.md", "/etc/passwd"]) {
    await expect(
      sendToInbox.handler({ message: "Invalid", artifact }, invocation(sessionId)),
    ).rejects.toThrow();
    expect(await getInboxEntry(sessionId)).toEqual(existing);
  }
});
