import { createStoredChannel } from "@channels/server/testFixtures";
import { describe, expect, onTestFinished, test } from "bun:test";
import { openTestDatabase } from "@/server/testFixtures";
import type { Session, SessionsState } from "@sessions/model";
import { DEFAULT_SETTINGS } from "@workspace/model/config/settings";
import { deleteSessionActivity, setSessionActivity } from "@sessions/server/state/activity";
import { deleteSavedDraft, saveDraft } from "@workspace/server/state/drafts";

import { AutomationDatabase } from "@automations/server/database";
import { ChannelDatabase } from "@channels/server/database";
import {
  registerWorkerSession,
  unregisterWorkerSession,
  WorkerDatabase,
} from "@workers/server/database";
import { saveSettings } from "@workspace/server/state/settings";
import { detachManagedSession, readSessionCatalog, resolveSessionType } from "./managedSessions";

function createInboxWorker(sessionId: string) {
  return registerWorkerSession({
    type: "inbox",
    sessionId,
    createdAt: new Date(0).toISOString(),
    ephemeral: false,
  });
}

describe("session type resolution", () => {
  test("defaults sessions without a managing record to standard", async () => {
    await openTestDatabase();
    expect(await resolveSessionType("toy-box-standard")).toEqual({ sessionType: "standard" });
  });

  test("resolves every managed session type from its authoritative record", async () => {
    const db = await openTestDatabase();
    const automation = await new AutomationDatabase(db).create({
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
    await saveSettings({ ...DEFAULT_SETTINGS, hyperSessionId: hyperId });
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

    expect(await resolveSessionType(automation.id)).toEqual({ sessionType: "automation" });
    expect(await resolveSessionType(hyperId)).toEqual({ sessionType: "hyper" });
    for (const [sessionId, type] of [
      [inboxId, "inbox"],
      [workerId, "app"],
      [channelWorkerId, "channel"],
    ]) {
      expect(await resolveSessionType(sessionId!)).toMatchObject({
        sessionType: "worker",
        worker: { type, sessionId },
      });
    }
    expect(await readSessionCatalog(catalogSource([]))).toEqual({
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

  test("the catalog rejects conflicting durable owners", async () => {
    const db = await openTestDatabase();
    const automation = await new AutomationDatabase(db).create({
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
    await expect(readSessionCatalog(catalogSource([]))).rejects.toThrow(
      `Session ${automation.id} has conflicting types: automation, worker`,
    );
  });
});

describe("Session catalog projection", () => {
  test("reserves 250 history slots independently of managed and pinned sessions", async () => {
    const db = await openTestDatabase();
    const automation = await new AutomationDatabase(db).create({
      title: "Old automation",
      prompt: "Run",
      model: { provider: "copilot", name: "gpt-5" },
      cron: "0 9 * * *",
    });
    await createInboxWorker("old-inbox");
    await registerWorkerSession({
      createdAt: new Date(0).toISOString(),
      type: "channel",
      channelId: "channel",
      sessionId: "old-channel-member",
      ephemeral: false,
    });
    await saveSettings({
      ...DEFAULT_SETTINGS,
      pinnedSessionIds: ["old-pin", "new-pin"],
      hyperSessionId: "old-hyper",
    });
    const history = Array.from({ length: 260 }, (_, i) => catalogSession(`history-${i}`, i + 1));
    const required = [automation.id, "old-inbox", "old-hyper", "old-channel-member", "old-pin"];
    const sessions = [
      ...required.map((id) => catalogSession(id, 0)),
      catalogSession("new-pin", 1000),
      ...history,
    ];
    const worktree = { branch: "old-work", baseBranch: "main", path: "/repo/old-work" };

    const catalog = await readSessionCatalog(catalogSource(sessions, { "history-0": worktree }));

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
    await openTestDatabase();
    const protectedIds = ["old-running", "old-waiting", "old-unread", "old-unsent"];
    for (const [index, status] of (["running", "waiting", "unread"] as const).entries()) {
      setSessionActivity(protectedIds[index]!, status);
    }
    saveDraft("session:old-unsent", "Unsent work", "test");
    onTestFinished(() => {
      protectedIds.forEach((id) => deleteSessionActivity(id));
      deleteSavedDraft("session:old-unsent");
    });
    const sessions = [
      ...protectedIds.map((id) => catalogSession(id, 0)),
      { ...catalogSession("old-draft", 0), provider: undefined },
      ...Array.from({ length: 260 }, (_, i) => catalogSession(`history-${i}`, i + 1)),
    ];

    const catalog = await readSessionCatalog(catalogSource(sessions));

    const sessionIds = catalog.sessions.map(({ id }) => id);
    expect(sessionIds).toHaveLength(255);
    expect(sessionIds).toEqual(expect.arrayContaining([...protectedIds, "old-draft"]));
    expect(sessionIds).not.toContain("history-0");
  });

  test("selects the same history window when equal timestamps arrive in another order", async () => {
    await openTestDatabase();
    const sessions = Array.from({ length: 260 }, (_, i) =>
      catalogSession(`session-${String(i).padStart(3, "0")}`, 1),
    );
    const read = (sessions: Session[]) =>
      readSessionCatalog({ list: async () => [sessions, {}], find: async () => [] });
    const first = await read(sessions);
    const second = await read([...sessions].reverse());

    expect(first.sessions.map(({ id }) => id).sort()).toEqual(
      second.sessions.map(({ id }) => id).sort(),
    );
    expect(first.sessions).toHaveLength(250);
  });

  test.each(["creation", "deletion"])(
    "keeps backing Sessions classified during concurrent %s",
    async (change) => {
      const db = await openTestDatabase();
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

      const catalog = await readSessionCatalog({
        async list() {
          if (change === "creation") {
            await admit();
          } else {
            await unregisterWorkerSession("channel-worker");
            await unregisterWorkerSession("worker");
            await new WorkerDatabase(db).delete("inbox");
          }
          return [sessions, { "channel-worker": worktree, worker: worktree }];
        },
        find: async () => [],
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

/** Lists the least one provider may: its newest `limit` Sessions, plus drafts. */
function catalogSource(
  sessions: Session[],
  worktrees: SessionsState["worktrees"] = {},
): Parameters<typeof readSessionCatalog>[0] {
  const newestFirst = sessions
    .filter(({ provider }) => provider)
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  return {
    list: async (limit) => [
      [...sessions.filter(({ provider }) => !provider), ...newestFirst.slice(0, limit)],
      worktrees,
    ],
    find: async (sessionIds) =>
      sessions.filter(({ id, provider }) => provider && sessionIds.includes(id)),
  };
}

test("detaching a Channel Agent removes its Worker and records the user's removal", async () => {
  const db = await openTestDatabase();
  const channels = new ChannelDatabase(db);
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
    { type: "member_left", actor: { type: "user" }, member },
  ]);
});
