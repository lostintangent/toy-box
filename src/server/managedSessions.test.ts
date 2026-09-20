import { describe, expect, mock, onTestFinished, test } from "bun:test";
import { createTestDatabase } from "@/server/database";

let currentDb: Bun.SQL | undefined;

mock.module("@/server/database", () => ({
  getStateDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const { AutomationDatabase } = await import("@automations/server/database");
const { ChannelDatabase } = await import("@channels/server/database");
const { createInboxEntry } = await import("@inbox/server/database");
const { registerWorkerSession, unregisterWorkerSession } = await import("@workers/server/database");
const { addHyperSession, deleteHyperState } = await import("@workspace/server/state/hyperSessions");
const { detachManagedSession, readSessionCatalog, resolveSessionType } =
  await import("./managedSessions");

async function openSessionTypeTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
  });
}

describe("session type resolution", () => {
  test("defaults sessions without a managing record to standard", async () => {
    await openSessionTypeTestDatabase();
    expect(await resolveSessionType("toy-box-standard")).toBe("standard");
  });

  test("resolves every managed session type from its authoritative record", async () => {
    await openSessionTypeTestDatabase();
    const automation = await new AutomationDatabase(currentDb!).create({
      title: "Managed automation",
      prompt: "Run",
      model: { provider: "copilot", name: "gpt-5" },
      cron: "0 9 * * *",
    });
    const inboxId = `toy-box-${crypto.randomUUID()}`;
    const hyperId = `toy-box-${crypto.randomUUID()}`;
    const workerId = `toy-box-${crypto.randomUUID()}`;
    const channelWorkerId = `toy-box-${crypto.randomUUID()}`;
    await createInboxEntry(inboxId);
    addHyperSession(hyperId);
    await registerWorkerSession({
      type: "app",
      sessionId: workerId,
      appId: "app-a",
      ephemeral: true,
    });
    await registerWorkerSession({
      type: "channel",
      channelId: "channel",
      sessionId: channelWorkerId,
      ephemeral: false,
      name: "Architect",
      metadata: { seenThrough: 0 },
    });
    onTestFinished(() => deleteHyperState(hyperId));

    expect(await resolveSessionType(automation.id)).toBe("automation");
    expect(await resolveSessionType(inboxId)).toBe("inbox");
    expect(await resolveSessionType(hyperId)).toBe("hyper");
    expect(await resolveSessionType(workerId)).toBe("worker");
    expect(await resolveSessionType(channelWorkerId)).toBe("worker");
  });

  test("rejects conflicting managed records", async () => {
    await openSessionTypeTestDatabase();
    const sessionId = `toy-box-${crypto.randomUUID()}`;
    await createInboxEntry(sessionId);
    addHyperSession(sessionId);
    onTestFinished(() => deleteHyperState(sessionId));

    expect(resolveSessionType(sessionId)).rejects.toThrow(
      `Session ${sessionId} has conflicting types: inbox, hyper`,
    );
  });
});

describe("Session catalog projection", () => {
  test.each(["creation", "deletion"])(
    "keeps backing Sessions classified during concurrent %s",
    async (change) => {
      await openSessionTypeTestDatabase();
      const admit = async () => {
        await registerWorkerSession({
          type: "channel",
          channelId: "channel",
          sessionId: "channel-worker",
          ephemeral: false,
          name: "Reviewer",
          metadata: { seenThrough: 0 },
        });
        await registerWorkerSession({
          type: "session",
          sessionId: "worker",
          parentSessionId: "parent",
          ephemeral: true,
        });
      };
      if (change === "deletion") await admit();
      const sessions = ["ordinary", "channel-worker", "worker"].map((sessionId) => ({
        id: sessionId,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        title: sessionId,
      }));
      const worktree = { branch: "work", baseBranch: "main", path: "/repo/work" };

      const catalog = await readSessionCatalog(async () => {
        if (change === "creation") {
          await admit();
        } else {
          await unregisterWorkerSession("channel-worker");
          await unregisterWorkerSession("worker");
        }
        return [sessions, { "channel-worker": worktree, worker: worktree }];
      });

      expect(catalog).toEqual({
        sessions,
        worktrees: { "channel-worker": worktree, worker: worktree },
        workerSessionParents: { "channel-worker": null, worker: "parent" },
      });
    },
  );
});

test("detaching a never-started Channel Agent removes its Worker", async () => {
  await openSessionTypeTestDatabase();
  const channels = new ChannelDatabase(currentDb!);
  const channel = await channels.createChannel({ title: "Dormant team" });
  const { member } = await channels.createMember({
    type: "channel",
    channelId: channel.id,
    sessionId: "dormant-reviewer",
    ephemeral: false,
    name: "Reviewer",
    metadata: { seenThrough: 0 },
  });

  await detachManagedSession(member.id);

  expect(await channels.getMember(member.id)).toBeNull();
  expect((await channels.listMessagesAfter(channel.id)).map(({ content }) => content)).toEqual([
    { type: "member_joined", member },
    { type: "member_left", member },
  ]);
});
