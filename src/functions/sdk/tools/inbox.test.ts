import { expect, mock, onTestFinished, test } from "bun:test";
import type { ToolInvocation } from "@github/copilot-sdk";
import type { Database } from "db0";
import { readFile } from "node:fs/promises";
import { createTestDatabase } from "@/functions/state/database";

let currentDb: Database | undefined;

mock.module("@/functions/state/database", () => ({
  getAppDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const { createInboxEntry, deleteInboxArtifact, getInboxEntries, resolveInboxArtifactPath } =
  await import("@/functions/state/workspace/inbox");
const { inboxTools } = await import("./inbox");

async function openInboxToolTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.dispose();
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

test("send_to_inbox completes its session's pending entry", async () => {
  await openInboxToolTestDatabase();
  const message = `Inbox tool ${crypto.randomUUID()}`;
  const sessionId = `toy-box-${crypto.randomUUID()}`;
  await createInboxEntry(sessionId);

  const [sendToInbox] = inboxTools;
  const result = await sendToInbox?.handler?.({ message }, invocation(sessionId));
  const { entryId } = JSON.parse(String(result)) as { entryId: string };

  expect(await getInboxEntries()).toContainEqual({
    id: entryId,
    message,
    createdAt: expect.any(String),
  });
  expect(entryId).toBe(sessionId);
});

test("send_to_inbox writes and attaches its optional artifact", async () => {
  await openInboxToolTestDatabase();
  const [sendToInbox] = inboxTools;
  const sessionId = `toy-box-${crypto.randomUUID()}`;
  await createInboxEntry(sessionId);
  onTestFinished(() => deleteInboxArtifact(sessionId));

  const sendResult = await sendToInbox?.handler?.(
    {
      message: "Research is ready",
      artifact: { filename: "research.md", content: "# Research" },
    },
    invocation(sessionId),
  );
  const { entryId } = JSON.parse(String(sendResult)) as { entryId: string };

  const artifactPath = resolveInboxArtifactPath(entryId, "research.md")!;
  expect(await readFile(artifactPath, "utf-8")).toBe("# Research");
  expect(await getInboxEntries()).toContainEqual({
    id: entryId,
    message: "Research is ready",
    createdAt: expect.any(String),
    artifact: "research.md",
  });
});

test("send_to_inbox rejects sessions without a pending inbox entry", async () => {
  await openInboxToolTestDatabase();
  const [sendToInbox] = inboxTools;
  const sessionId = `toy-box-${crypto.randomUUID()}`;

  expect(sendToInbox?.handler?.({ message: "Unexpected" }, invocation(sessionId))).rejects.toThrow(
    "Inbox entry not found.",
  );
});
