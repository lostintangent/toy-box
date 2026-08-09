import { afterAll, beforeEach, describe, expect, mock, onTestFinished, test } from "bun:test";
import * as databaseModule from "@/server/database";
import * as sessionRuntimeModule from "@sessions/server/runtime";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import type { WorkspaceEvent } from "@workspace/model/events";
import type { AutomationOptions } from "../model";
import { AutomationDatabase } from "./database";

const realDatabaseModule = { ...databaseModule };
const realSessionRuntimeModule = { ...sessionRuntimeModule };
let currentDb: Bun.SQL | undefined;
const deleteSessionIfExistsMock = mock(async (_sessionId: string) => true);

mock.module("@/server/database", () => ({
  ...realDatabaseModule,
  getStateDatabase: async (options?: { createIfMissing?: boolean }) => {
    if (!currentDb && options?.createIfMissing === false) return null;
    if (!currentDb) throw new Error("Test database has not been opened.");
    return currentDb;
  },
}));
mock.module("@sessions/server/runtime", () => ({
  ...realSessionRuntimeModule,
  deleteSessionIfExists: deleteSessionIfExistsMock,
}));

const { createAutomation, deleteAutomation, listAutomations, updateAutomation } =
  await import("./index");

afterAll(() => {
  mock.module("@/server/database", () => realDatabaseModule);
  mock.module("@sessions/server/runtime", () => realSessionRuntimeModule);
});

beforeEach(() => {
  currentDb = undefined;
  deleteSessionIfExistsMock.mockClear();
  deleteSessionIfExistsMock.mockImplementation(async () => true);
});

const options = {
  title: "Daily summary",
  prompt: "Summarize the repository.",
  model: { name: "gpt-5" },
  cron: "0 9 * * *",
} satisfies AutomationOptions;

describe("automation lifecycle", () => {
  test("lists no definitions before state storage exists", async () => {
    expect(await listAutomations()).toEqual([]);
  });

  test("publishes definition changes and tears down the managed session before deletion", async () => {
    const database = await openTestDatabase();
    const events = captureAutomationEvents();

    const created = await createAutomation(options);
    const updated = await updateAutomation(created.id, {
      ...options,
      title: "Morning summary",
    });
    if (!updated) throw new Error("Expected the automation to be updated.");

    expect(updated.title).toBe("Morning summary");
    expect(await listAutomations()).toEqual([updated]);
    expect(await deleteAutomation(created.id)).toBe(true);
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith(created.id);
    expect(await new AutomationDatabase(database).get(created.id)).toBeNull();
    expect(events).toEqual([
      { type: "automation.upserted", automation: created },
      { type: "automation.upserted", automation: updated },
      { type: "automation.deleted", automationId: created.id },
    ]);
  });

  test("does not publish or tear down a definition that does not exist", async () => {
    await openTestDatabase();
    const events = captureAutomationEvents();

    expect(await updateAutomation("missing", options)).toBeNull();
    expect(await deleteAutomation("missing")).toBe(false);
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

async function openTestDatabase(): Promise<Bun.SQL> {
  currentDb = await databaseModule.createTestDatabase();
  const database = currentDb;
  onTestFinished(async () => database.close());
  return database;
}

function captureAutomationEvents(): WorkspaceEvent[] {
  const events: WorkspaceEvent[] = [];
  const unsubscribe = subscribeWorkspaceEvents((event) => {
    if (event.type.startsWith("automation.")) events.push(event);
  });
  onTestFinished(unsubscribe);
  return events;
}
