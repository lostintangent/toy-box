import { expect, mock, onTestFinished, test } from "bun:test";
import type { CopilotSession, ToolInvocation } from "@github/copilot-sdk";
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

  // Drive a real stream with a fake SDK session so the tool's workspace write is observable.
  const createdFiles: Array<{ path: string; content: string }> = [];
  const fakeSession = {
    on: () => () => {},
    send: async () => {},
    abort: async () => {},
    rpc: {
      queue: { clear: async () => {} },
      workspaces: {
        createFile: async (params: { path: string; content: string }) => {
          createdFiles.push(params);
        },
      },
    },
  } as unknown as CopilotSession;
  const stream = SessionStream.getOrCreate(sessionId, fakeSession);
  onTestFinished(() => stream.finish());

  const [sendToInbox] = inboxTools;
  const sendResult = await sendToInbox?.handler?.(
    {
      message: "Research is ready",
      artifact: { filename: "research.md", content: "# Research" },
    },
    invocation(sessionId),
  );
  const { entryId } = JSON.parse(String(sendResult)) as { entryId: string };

  expect(createdFiles).toEqual([{ path: "research.md", content: "# Research" }]);
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
