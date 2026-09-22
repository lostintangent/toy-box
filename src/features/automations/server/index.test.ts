import { describe, expect, onTestFinished, setSystemTime, spyOn, test } from "bun:test";
import * as state from "@/server/database";
import * as sessions from "@sessions/server/runtime";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import type { SessionCompletion } from "@sessions/model";
import type { WorkspaceEvent } from "@workspace/model/events";
import type { AutomationOptions } from "../model";
import { AutomationDatabase } from "./database";
import {
  createAutomation,
  deleteAutomation,
  listAutomations,
  runAutomation,
  updateAutomation,
} from "./index";
import { runSchedulerTick } from "./scheduler";

const options = {
  title: "Daily summary",
  prompt: "Summarize the repository.",
  model: { provider: "copilot", name: "gpt-5", reasoningEffort: "high" },
  cron: "0 9 * * *",
  cwd: "/repo/automation",
} satisfies AutomationOptions;

describe("automation lifecycle", () => {
  test("lists no definitions before state storage exists", async () => {
    const database = spyOn(state, "getStateDatabase").mockResolvedValue(null);
    onTestFinished(() => database.mockRestore());
    expect(await listAutomations()).toEqual([]);
  });

  test("publishes definition changes and deletes the session before its definition", async () => {
    const { database, events, deleteSession } = await setup();
    const created = await createAutomation(options);
    const updated = await updateAutomation(created.id, { ...options, title: "Morning summary" });
    expect(await listAutomations()).toEqual([updated]);
    expect(updated.title).toBe("Morning summary");

    deleteSession.mockImplementationOnce(async (sessionId) => {
      expect(sessionId).toBe(created.id);
      expect(await database.get(sessionId)).toEqual(updated);
      return true;
    });
    expect(await deleteAutomation(created.id)).toBe(true);
    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(await listAutomations()).toEqual([]);
    expect(events).toEqual([
      { type: "automation.upserted", automation: created },
      { type: "automation.upserted", automation: updated },
      { type: "automation.deleted", automationId: created.id },
    ]);
  });

  test("does not publish or tear down a definition that does not exist", async () => {
    const { events, deleteSession } = await setup();
    await expect(updateAutomation("missing", options)).rejects.toThrow("Automation not found");
    expect(await deleteAutomation("missing")).toBe(false);
    expect(deleteSession).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  test("runs the saved definition under its stable ID with the client's message ID", async () => {
    const { database, recreate } = await setup();
    const automation = await database.create(options);

    expect(await runAutomation(automation.id, "requested-run")).toEqual({
      sessionId: automation.id,
      started: true,
    });
    expect(recreate).toHaveBeenCalledWith(
      automation.id,
      { clientId: "requested-run", content: options.prompt, model: options.model },
      { directory: options.cwd, name: options.title, sessionType: "automation" },
    );
  });

  test("does not replace an active run", async () => {
    const { database, running, recreate } = await setup();
    const automation = await database.create(options);
    running.mockReturnValue(true);

    expect(await runAutomation(automation.id)).toEqual({
      sessionId: automation.id,
      started: false,
    });
    expect(recreate).not.toHaveBeenCalled();
  });

  test("coalesces concurrent starts before a live session exists", async () => {
    const { database, recreate } = await setup();
    const automation = await database.create(options);

    const results = await Promise.all([runAutomation(automation.id), runAutomation(automation.id)]);

    expect(results).toEqual([
      { sessionId: automation.id, started: true },
      { sessionId: automation.id, started: false },
    ]);
    expect(recreate).toHaveBeenCalledTimes(1);
  });

  test.each(["completed", "failed"] as const)(
    "finalizes a %s run and permits another under the same session ID",
    async (status) => {
      const { database, events, completion, released, recreate } = await setup();
      const automation = await database.create(options);
      await runAutomation(automation.id);
      expect((await database.get(automation.id))?.lastRunAt).toBeUndefined();
      expect(events).toEqual([]);

      completion.resolve({ status });
      expect(await released.promise).toBe(automation.id);

      const updated = (await database.get(automation.id))!;
      expect(updated.lastRunAt).toEqual(expect.any(String));
      expect(events).toEqual([{ type: "automation.upserted", automation: updated }]);

      recreate.mockResolvedValueOnce({
        disposition: "started",
        waitForCompletion: () => new Promise(() => {}),
      });
      expect(await runAutomation(automation.id)).toEqual({
        sessionId: automation.id,
        started: true,
      });
      expect(recreate.mock.calls.map(([sessionId]) => sessionId)).toEqual([
        automation.id,
        automation.id,
      ]);
    },
  );

  test("a failed start leaves metadata unchanged and permits another run", async () => {
    const { database, events, recreate } = await setup();
    const automation = await database.create(options);
    recreate.mockRejectedValueOnce(new Error("Could not recreate session"));

    await expect(runAutomation(automation.id)).rejects.toThrow("Could not recreate session");
    expect(await database.get(automation.id)).toEqual(automation);
    expect(events).toEqual([]);
    expect(await runAutomation(automation.id)).toEqual({ sessionId: automation.id, started: true });
  });

  test("releases the connection without publishing metadata that failed to persist", async () => {
    const { db, database, events, completion, released } = await setup();
    const log = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    const automation = await database.create(options);

    await runAutomation(automation.id);
    await db`DROP TABLE automations`;
    completion.resolve({ status: "completed" });

    expect(await released.promise).toBe(automation.id);
    expect(events).toEqual([]);
  });

  test("publishes due claims, continues after a failed start, and never redispatches a claim", async () => {
    const { database, events, recreate, completion } = await setup();
    const log = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => {
      log.mockRestore();
      setSystemTime();
    });
    setSystemTime(new Date("2026-02-14T10:00:00.000Z"));
    const failing = await database.create({ ...options, title: "Fails", cron: "* * * * *" });
    setSystemTime(new Date("2026-02-14T10:01:00.000Z"));
    const succeeding = await database.create({ ...options, title: "Runs", cron: "* * * * *" });
    setSystemTime(new Date("2026-02-14T10:02:30.000Z"));
    const publishedAtDispatch: Array<WorkspaceEvent | undefined> = [];
    recreate.mockImplementation(async (sessionId) => {
      publishedAtDispatch.push(events.at(-1));
      if (sessionId === failing.id) throw new Error("Could not start");
      return { disposition: "started", waitForCompletion: () => completion.promise };
    });

    await runSchedulerTick();
    expect(recreate.mock.calls.map(([sessionId]) => sessionId)).toEqual([
      failing.id,
      succeeding.id,
    ]);
    expect(publishedAtDispatch).toEqual([
      {
        type: "automation.upserted",
        automation: { ...failing, nextRunAt: "2026-02-14T10:03:00.000Z" },
      },
      {
        type: "automation.upserted",
        automation: { ...succeeding, nextRunAt: "2026-02-14T10:03:00.000Z" },
      },
    ]);
    const claims = [...events];

    await runSchedulerTick();
    expect(recreate).toHaveBeenCalledTimes(2);
    expect(events).toEqual(claims);
  });
});

async function setup() {
  const db = await state.createTestDatabase();
  const database = new AutomationDatabase(db);
  const readDatabase = spyOn(state, "getStateDatabase").mockResolvedValue(db);
  const deleteSession = spyOn(sessions, "deleteSessionIfExists").mockResolvedValue(true);
  const running = spyOn(sessions, "isSessionRunning").mockReturnValue(false);
  const completion = Promise.withResolvers<SessionCompletion>();
  const released = Promise.withResolvers<string>();
  const recreate = spyOn(sessions, "recreateSession").mockResolvedValue({
    disposition: "started",
    waitForCompletion: () => completion.promise,
  });
  const release = spyOn(sessions, "releaseIdleSession").mockImplementation(async (sessionId) => {
    released.resolve(sessionId);
  });
  const events: WorkspaceEvent[] = [];
  const unsubscribe = subscribeWorkspaceEvents((event) => {
    if (event.type.startsWith("automation.")) events.push(event);
  });

  onTestFinished(async () => {
    unsubscribe();
    readDatabase.mockRestore();
    deleteSession.mockRestore();
    running.mockRestore();
    recreate.mockRestore();
    release.mockRestore();
    await db.close();
  });
  return { db, database, events, deleteSession, running, recreate, completion, released };
}
