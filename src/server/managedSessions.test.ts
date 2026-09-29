import { createStoredChannel } from "@channels/server/testFixtures";
import { describe, expect, mock, onTestFinished, test } from "bun:test";
import { createTestDatabase } from "@/server/database";
import type { Session } from "@sessions/model";
import { DEFAULT_SETTINGS } from "@workspace/model/config/settings";
import { SettingsDatabase } from "@workspace/server/state/settings";
import { applySessionState, deleteSessionState } from "@workspace/server/state/sessions";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import type { WorkspaceEvent } from "@workspace/model/events";

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
const { registerWorkerSession, unregisterWorkerSession, WorkerDatabase } =
  await import("@workers/server/database");
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

function createInboxWorker(sessionId: string) {
  return new WorkerDatabase(currentDb!).create({
    type: "inbox",
    sessionId,
    createdAt: new Date(0).toISOString(),
    ephemeral: false,
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
    await createInboxWorker(inboxId);
    addHyperSession(hyperId);
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
      type: "app",
      sessionId: workerId,
      appId: "app-a",
      ephemeral: true,
    });
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
      type: "channel",
      channelId: "channel",
      sessionId: channelWorkerId,
      ephemeral: false,
      name: "Architect",
      metadata: { seenThrough: 0 },
    });
    onTestFinished(() => deleteHyperState(hyperId));

    expect(await resolveSessionType(automation.id)).toBe("automation");
    expect(await resolveSessionType(inboxId)).toBe("worker");
    expect(await resolveSessionType(hyperId)).toBe("hyper");
    expect(await resolveSessionType(workerId)).toBe("worker");
    expect(await resolveSessionType(channelWorkerId)).toBe("worker");
    expect(await readSessionCatalog(async () => [[], {}])).toEqual({
      sessions: [],
      worktrees: {},
      ownership: {
        [automation.id]: { type: "automation" },
        [inboxId]: { type: "worker", parentSessionId: null },
        [workerId]: { type: "worker", parentSessionId: null },
        [channelWorkerId]: { type: "worker", parentSessionId: null },
      },
    });
  });

  test("rejects conflicting managed records", async () => {
    await openSessionTypeTestDatabase();
    const sessionId = `toy-box-${crypto.randomUUID()}`;
    await createInboxWorker(sessionId);
    addHyperSession(sessionId);
    onTestFinished(() => deleteHyperState(sessionId));

    expect(resolveSessionType(sessionId)).rejects.toThrow(
      `Session ${sessionId} has conflicting types: worker, hyper`,
    );
  });

  test("catalog and runtime resolution reject the same conflicting durable owners", async () => {
    await openSessionTypeTestDatabase();
    const automation = await new AutomationDatabase(currentDb!).create({
      title: "Conflicting owner",
      prompt: "Run",
      model: { provider: "copilot", name: "gpt-5" },
      cron: "0 9 * * *",
    });
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
      type: "session",
      sessionId: automation.id,
      parentSessionId: "parent",
      ephemeral: false,
    });
    const message = `Session ${automation.id} has conflicting types: automation, worker`;
    await expect(resolveSessionType(automation.id)).rejects.toThrow(message);
    await expect(readSessionCatalog(async () => [[], {}])).rejects.toThrow(message);
  });
});

describe("Session catalog projection", () => {
  test("reserves 250 history slots independently of managed and pinned sessions", async () => {
    await openSessionTypeTestDatabase();
    const automation = await new AutomationDatabase(currentDb!).create({
      title: "Old automation",
      prompt: "Run",
      model: { provider: "copilot", name: "gpt-5" },
      cron: "0 9 * * *",
    });
    await createInboxWorker("old-inbox");
    addHyperSession("old-hyper");
    onTestFinished(() => deleteHyperState("old-hyper"));
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
      type: "channel",
      channelId: "channel",
      sessionId: "old-channel-member",
      ephemeral: false,
    });
    await new SettingsDatabase(currentDb!).set({
      ...DEFAULT_SETTINGS,
      pinnedSessionIds: ["old-pin", "new-pin"],
    });
    const history = Array.from({ length: 260 }, (_, i) => catalogSession(`history-${i}`, i + 1));
    const required = [automation.id, "old-inbox", "old-hyper", "old-channel-member", "old-pin"];
    const sessions = [
      ...required.map((id) => catalogSession(id, 0)),
      catalogSession("new-pin", 1000),
      ...history,
    ];
    const worktree = { branch: "old-work", baseBranch: "main", path: "/repo/old-work" };

    const catalog = await readSessionCatalog(async () => [sessions, { "history-0": worktree }]);

    expect(catalog.sessions.map(({ id }) => id).sort()).toEqual(
      [...required, "new-pin", ...history.slice(10).map(({ id }) => id)].sort(),
    );
    expect(catalog.ownership).toEqual({
      [automation.id]: { type: "automation" },
      "old-inbox": { type: "worker", parentSessionId: null },
      "old-channel-member": { type: "worker", parentSessionId: null },
    });
    // Resource ownership is independent of the browsing window.
    expect(catalog.worktrees["history-0"]).toEqual(worktree);
  });

  test("retains older running, waiting, unread and draft work outside the history window", async () => {
    await openSessionTypeTestDatabase();
    const protectedIds = ["old-running", "old-waiting", "old-unread", "old-prompt"];
    for (const [index, status] of (["running", "waiting", "unread"] as const).entries()) {
      applySessionState({ type: `session.${status}`, sessionId: protectedIds[index]!, at: 1 });
    }
    applySessionState({
      type: "session.prompt.drafted",
      sessionId: "old-prompt",
      prompt: { text: "Unsent work", origin: "test", updatedAt: Date.now() },
    });
    onTestFinished(() => protectedIds.forEach((id) => deleteSessionState(id)));
    const sessions = [
      ...protectedIds.map((id) => catalogSession(id, 0)),
      { ...catalogSession("old-draft", 0), provider: undefined },
      ...Array.from({ length: 260 }, (_, i) => catalogSession(`history-${i}`, i + 1)),
    ];

    const catalog = await readSessionCatalog(async () => [sessions, {}]);

    const sessionIds = catalog.sessions.map(({ id }) => id);
    expect(sessionIds).toHaveLength(255);
    expect(sessionIds).toEqual(expect.arrayContaining([...protectedIds, "old-draft"]));
    expect(sessionIds).not.toContain("history-0");
  });

  test("selects the same history window when equal timestamps arrive in another order", async () => {
    await openSessionTypeTestDatabase();
    const sessions = Array.from({ length: 260 }, (_, i) =>
      catalogSession(`session-${String(i).padStart(3, "0")}`, 1),
    );
    const first = await readSessionCatalog(async () => [sessions, {}]);
    const second = await readSessionCatalog(async () => [[...sessions].reverse(), {}]);

    expect(first.sessions.map(({ id }) => id).sort()).toEqual(
      second.sessions.map(({ id }) => id).sort(),
    );
    expect(first.sessions).toHaveLength(250);
  });

  test.each(["creation", "deletion"])(
    "keeps backing Sessions classified during concurrent %s",
    async (change) => {
      await openSessionTypeTestDatabase();
      const admit = async () => {
        await createInboxWorker("inbox");
        await registerWorkerSession({
          createdAt: new Date(0).toISOString(),
          type: "channel",
          channelId: "channel",
          sessionId: "channel-worker",
          ephemeral: false,
          name: "Reviewer",
          metadata: { seenThrough: 0 },
        });
        await registerWorkerSession({
          createdAt: new Date(0).toISOString(),
          type: "session",
          sessionId: "worker",
          parentSessionId: "parent",
          ephemeral: true,
        });
      };
      if (change === "deletion") await admit();
      const sessions = ["ordinary", "channel-worker", "worker", "inbox"].map((sessionId) => ({
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
          await new WorkerDatabase(currentDb!).delete("inbox");
        }
        return [sessions, { "channel-worker": worktree, worker: worktree }];
      });

      expect(catalog).toEqual({
        sessions,
        worktrees: { "channel-worker": worktree, worker: worktree },
        ownership: {
          "channel-worker": { type: "worker", parentSessionId: null },
          worker: { type: "worker", parentSessionId: "parent" },
          inbox: { type: "worker", parentSessionId: null },
        },
      });
    },
  );
});

function catalogSession(id: string, updatedAt: number): Session {
  return {
    id,
    provider: { id: "codex" },
    title: id,
    createdAt: new Date(0),
    updatedAt: new Date(updatedAt),
  };
}

test("detaching a Channel Agent removes its Worker and records its departure", async () => {
  await openSessionTypeTestDatabase();
  const channels = new ChannelDatabase(currentDb!);
  const channel = await createStoredChannel(channels, {
    name: "Dormant team",
    purpose: "Coordinate a dormant team.",
    model: { provider: "copilot", name: "gpt-5.5" },
  });
  const { member } = await channels.createMember({
    createdAt: new Date(0).toISOString(),
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

test("shared teardown publishes one Inbox deletion even when callers detach concurrently", async () => {
  await openSessionTypeTestDatabase();
  const sessionId = crypto.randomUUID();
  await createInboxWorker(sessionId);
  const events: WorkspaceEvent[] = [];
  onTestFinished(
    subscribeWorkspaceEvents((event) => {
      if (event.type === "inbox.entry.deleted" && event.entryId === sessionId) events.push(event);
    }),
  );

  await Promise.all([detachManagedSession(sessionId), detachManagedSession(sessionId)]);
  await detachManagedSession(sessionId);

  expect(await new WorkerDatabase(currentDb!).get(sessionId)).toBeNull();
  expect(events).toEqual([{ type: "inbox.entry.deleted", entryId: sessionId }]);
});
