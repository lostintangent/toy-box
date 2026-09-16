import type { SessionConnection } from "@providers/server/provider";
import { resolveSessionArtifactPath } from "@files/server/paths";
import { deleteSessionFiles, listSessionArtifacts } from "@sessions/server/artifacts";
import { expect, mock, onTestFinished, test } from "bun:test";
import type { ToolInvocation } from "@github/copilot-sdk";
import { createTestDatabase } from "@/server/database";
import { SessionStream } from "@sessions/server/runtime/sessionStream";

let currentDb: Bun.SQL | undefined;

mock.module("@/server/database", () => ({
  getStateDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const { createInboxEntry, listInboxEntries } = await import("./database");
const { inboxTools } = await import("./tools");

async function openInboxToolTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
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

test("send_to_inbox completes its session's pending entry", async () => {
  await openInboxToolTestDatabase();
  const message = `Inbox tool ${crypto.randomUUID()}`;
  const sessionId = `toy-box-${crypto.randomUUID()}`;
  await createInboxEntry(sessionId);

  const [sendToInbox] = inboxTools;
  const result = await sendToInbox?.handler?.({ message }, invocation(sessionId));
  const { entryId } = JSON.parse(String(result)) as { entryId: string };

  expect(await listInboxEntries()).toContainEqual({
    id: entryId,
    message,
    createdAt: expect.any(String),
  });
  expect(entryId).toBe(sessionId);
});

test("send_to_inbox writes its artifact to the session workspace and attaches the filename", async () => {
  await openInboxToolTestDatabase();
  const sessionId = `toy-box-${crypto.randomUUID()}`;
  await createInboxEntry(sessionId);

  const fakeSession = {
    identity: { sessionId, providerId: "copilot", nativeId: sessionId },
    onEvent: () => () => {},
  } as unknown as SessionConnection;
  const stream = SessionStream.getOrCreate(sessionId, fakeSession);
  onTestFinished(async () => {
    stream.finish();
    await deleteSessionFiles(sessionId);
  });

  const [sendToInbox] = inboxTools;
  const sendResult = await sendToInbox?.handler?.(
    {
      message: "Research is ready",
      artifact: { filename: "research.md", content: "# Research" },
    },
    invocation(sessionId),
  );
  const { entryId } = JSON.parse(String(sendResult)) as { entryId: string };

  expect(await Bun.file(resolveSessionArtifactPath(sessionId, "research.md")!).text()).toBe(
    "# Research",
  );
  expect(await listSessionArtifacts(sessionId)).toEqual(["research.md"]);
  expect(await listInboxEntries()).toContainEqual({
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
