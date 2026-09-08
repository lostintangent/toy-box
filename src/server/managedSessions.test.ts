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

const { AgentDatabase } = await import("@agents/server/database");
const { AutomationDatabase } = await import("@automations/server/database");
const { createInboxEntry } = await import("@inbox/server/database");
const { registerWorkerSession, unregisterWorkerSession } = await import("@workers/server/database");
const { addHyperSession, deleteHyperState } = await import("@workspace/server/state/hyperSessions");
const { readSessionCatalog, resolveSessionType } = await import("./managedSessions");

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
      model: { name: "gpt-5" },
      cron: "0 9 * * *",
    });
    const inboxId = `toy-box-${crypto.randomUUID()}`;
    const hyperId = `toy-box-${crypto.randomUUID()}`;
    const workerId = `toy-box-${crypto.randomUUID()}`;
    const agentSessionId = `toy-box-${crypto.randomUUID()}`;
    await createInboxEntry(inboxId);
    addHyperSession(hyperId);
    await registerWorkerSession({
      type: "app",
      sessionId: workerId,
      appId: "app-a",
      ephemeral: true,
    });
    const agents = new AgentDatabase(currentDb!);
    const agent = await agents.createAgent({ name: "Architect" });
    await agents.createMembership({
      host: { kind: "session", sessionId: "toy-box-host" },
      agentId: agent.id,
      sessionId: agentSessionId,
      executionMode: "shared",
    });
    onTestFinished(() => deleteHyperState(hyperId));

    expect(await resolveSessionType(automation.id)).toBe("automation");
    expect(await resolveSessionType(inboxId)).toBe("inbox");
    expect(await resolveSessionType(hyperId)).toBe("hyper");
    expect(await resolveSessionType(workerId)).toBe("worker");
    expect(await resolveSessionType(agentSessionId)).toBe("agent");
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
      const agents = new AgentDatabase(currentDb!);
      const agent = await agents.createAgent({ name: "Reviewer" });
      const admit = async () => {
        await agents.createMembership({
          host: { kind: "session", sessionId: "parent" },
          agentId: agent.id,
          sessionId: "private-agent",
          executionMode: "worktree",
        });
        await registerWorkerSession({
          type: "session",
          sessionId: "worker",
          parentSessionId: "parent",
          ephemeral: true,
        });
      };
      if (change === "deletion") await admit();
      const sessions = ["ordinary", "private-agent", "worker"].map((sessionId) => ({
        sessionId,
        startTime: new Date(0),
        modifiedTime: new Date(0),
        summary: sessionId,
        isRemote: false,
      }));
      const worktree = { branch: "work", baseBranch: "main", path: "/repo/work" };

      const catalog = await readSessionCatalog(async () => {
        if (change === "creation") {
          await admit();
        } else {
          await agents.deleteMembershipBySession("private-agent");
          await unregisterWorkerSession("worker");
        }
        return [sessions, { "private-agent": worktree, worker: worktree }];
      });

      expect(catalog).toEqual({
        sessions: [sessions[0], sessions[2]],
        worktrees: { worker: worktree },
        workerSessionParents: { worker: "parent" },
      });
    },
  );
});
