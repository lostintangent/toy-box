import { describe, expect, mock, onTestFinished, test } from "bun:test";
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

const { AutomationDatabase } = await import("@/functions/automations/database");
const { createInboxEntry } = await import("../workspace/inbox");
const { addHyperSession, deleteHyperState } = await import("../workspace/hyperSessions");
const { linkChildSession } = await import("./children");
const { resolveSessionType } = await import("./type");

async function openSessionTypeTestDatabase(): Promise<void> {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.dispose();
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
    const childId = `toy-box-${crypto.randomUUID()}`;
    await createInboxEntry(inboxId);
    addHyperSession(hyperId);
    await linkChildSession(childId, "toy-box-parent");
    onTestFinished(() => deleteHyperState(hyperId));

    expect(await resolveSessionType(automation.id)).toBe("automation");
    expect(await resolveSessionType(inboxId)).toBe("inbox");
    expect(await resolveSessionType(hyperId)).toBe("hyper");
    expect(await resolveSessionType(childId)).toBe("child");
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
