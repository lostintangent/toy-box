import type { Database } from "db0";
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  mock,
  onTestFinished,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import * as databaseModule from "@/functions/state/database";
import * as sessionRegistryModule from "@/functions/state/session/registry";
import * as streamModule from "@/functions/runtime/stream";
import * as broadcastModule from "@/functions/runtime/broadcast";
import type { Automation, AutomationEvent, AutomationOptions } from "@/types";
import { AutomationDatabase } from "./database";

const realDatabaseModule = { ...databaseModule };
const realSessionRegistryModule = { ...sessionRegistryModule };
const realStreamModule = { ...streamModule };
const realBroadcastModule = { ...broadcastModule };

type CreateSession = typeof streamModule.createSession;
type CreationArguments = Parameters<CreateSession>;
type CreationReceipt = Awaited<ReturnType<CreateSession>>;

let appDatabase: Database;
let automationDatabase: AutomationDatabase;
let create: (...args: CreationArguments) => Promise<CreationReceipt>;
let removeSession: typeof sessionRegistryModule.deleteSessionIfExists;
const runningSessionIds = new Set<string>();

const createSessionMock = mock((...args: CreationArguments) => create(...args));
const deleteSessionIfExistsMock = mock((sessionId: string) => removeSession(sessionId));
const emitAutomationEventMock = mock((_event: AutomationEvent) => {});

mock.module("@/functions/state/database", () => ({
  getAppDatabase: async () => appDatabase,
}));
mock.module("@/functions/state/session/registry", () => ({
  deleteSessionIfExists: deleteSessionIfExistsMock,
}));
mock.module("@/functions/runtime/stream", () => ({
  createSession: createSessionMock,
  SessionStream: {
    isRunning: (sessionId: string) => runningSessionIds.has(sessionId),
  },
}));
mock.module("@/functions/runtime/broadcast", () => ({
  emitAutomationEvent: emitAutomationEventMock,
}));

const { runSchedulerTick, startAutomationRun } = await import("./scheduler");

afterAll(() => {
  mock.module("@/functions/state/database", () => realDatabaseModule);
  mock.module("@/functions/state/session/registry", () => realSessionRegistryModule);
  mock.module("@/functions/runtime/stream", () => realStreamModule);
  mock.module("@/functions/runtime/broadcast", () => realBroadcastModule);
});

beforeEach(async () => {
  setSystemTime();
  appDatabase = await realDatabaseModule.createTestDatabase();
  automationDatabase = new AutomationDatabase(appDatabase);
  runningSessionIds.clear();
  deleteSessionIfExistsMock.mockClear();
  createSessionMock.mockClear();
  emitAutomationEventMock.mockClear();
  removeSession = async () => false;
  create = async () => ({
    disposition: "started",
    waitForCompletion: () => new Promise(() => {}),
  });
});

describe.serial("automation scheduler", () => {
  test("resets the owned session and creates it through the configured prompt", async () => {
    const automation = await createAutomation({
      title: "Daily summary",
      prompt: "Summarize repository status.",
      model: { name: "gpt-5", reasoningEffort: "high" },
      cwd: "/repo/automation",
    });

    const result = await startAutomationRun(automation.id);

    expect(result).toEqual({ sessionId: automation.id, started: true });
    expect(deleteSessionIfExistsMock).toHaveBeenCalledWith(automation.id);
    expect(createSessionMock).toHaveBeenCalledWith(
      automation.id,
      {
        content: automation.prompt,
        model: automation.model,
      },
      {
        directory: automation.cwd,
        summary: automation.title,
        sessionType: "automation",
      },
    );
    expect(readAutomationEvents()).toEqual([]);
  });

  test("does not start when resetting the owned session fails", async () => {
    const automation = await createAutomation();
    removeSession = async () => {
      throw new Error("delete failed");
    };

    await expect(startAutomationRun(automation.id)).rejects.toThrow("delete failed");
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(readAutomationEvents()).toEqual([]);
  });

  test("uses the same owned session across idle runs", async () => {
    const automation = await createAutomation();

    const first = await startAutomationRun(automation.id);
    const second = await startAutomationRun(automation.id);

    expect(first).toEqual({ sessionId: automation.id, started: true });
    expect(second).toEqual({ sessionId: automation.id, started: true });
    expect(deleteSessionIfExistsMock).toHaveBeenCalledTimes(2);
    expect(createSessionMock).toHaveBeenCalledTimes(2);
  });

  test("does not overlap an active run", async () => {
    const automation = await createAutomation();
    runningSessionIds.add(automation.id);

    await expect(startAutomationRun(automation.id)).resolves.toEqual({
      sessionId: automation.id,
      started: false,
    });
    expect(deleteSessionIfExistsMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(readAutomationEvents()).toEqual([]);
  });

  test("coalesces concurrent attempts before the run reaches the stream registry", async () => {
    const automation = await createAutomation();
    let releaseDelivery!: () => void;
    const deliveryGate = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    create = async () => {
      await deliveryGate;
      return {
        disposition: "started",
        waitForCompletion: () => new Promise(() => {}),
      };
    };

    const first = startAutomationRun(automation.id);
    const second = startAutomationRun(automation.id);
    releaseDelivery();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.started).toBe(true);
    expect(secondResult).toEqual({ sessionId: firstResult.sessionId, started: false });
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  test.each([
    { name: "completed", completion: { status: "completed" as const } },
    { name: "failed", completion: { status: "failed" as const } },
  ])("records and broadcasts metadata after a $name stream", async ({ completion }) => {
    const automation = await createAutomation();
    const heldCompletion = holdCompletion();

    const { sessionId } = await startAutomationRun(automation.id);
    heldCompletion.resolve(completion);
    await waitForAutomationEvents(1);

    const updated = (await automationDatabase.get(automation.id))!;
    expect(updated?.lastRunAt).toEqual(expect.any(String));
    expect(updated?.id).toBe(sessionId);
    expect(readAutomationEvents()).toEqual([{ type: "automation.updated", automation: updated }]);
  });

  test("leaves automation metadata unchanged when creation cannot start", async () => {
    const automation = await createAutomation();
    create = async () => {
      throw new Error("delivery failed");
    };

    await expect(startAutomationRun(automation.id)).rejects.toThrow("delivery failed");

    expect(readAutomationEvents()).toEqual([]);
    expect((await automationDatabase.get(automation.id))?.lastRunAt).toBeUndefined();
  });

  test("does not publish an update when run metadata cannot be persisted", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => consoleError.mockRestore());
    const automation = await createAutomation();
    const heldCompletion = holdCompletion();

    await startAutomationRun(automation.id);
    await appDatabase.exec("DROP TABLE automations");
    heldCompletion.resolve({ status: "completed" });
    await waitFor(() => consoleError.mock.calls.length === 1);

    expect(readAutomationEvents()).toEqual([]);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  test("claims every due automation once and continues after one cannot start", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => {
      consoleError.mockRestore();
      setSystemTime();
    });
    setSystemTime(new Date("2026-02-14T10:00:00.000Z"));
    const failing = await createAutomation({ title: "Fails", cron: "* * * * *" });
    const succeeding = await createAutomation({ title: "Runs", cron: "* * * * *" });
    setSystemTime(new Date("2026-02-14T10:01:30.000Z"));
    create = async (sessionId) => {
      if (sessionId === failing.id) throw new Error("delivery failed");
      return {
        disposition: "started",
        waitForCompletion: () => new Promise(() => {}),
      };
    };

    await runSchedulerTick();

    expect(createSessionMock).toHaveBeenCalledTimes(2);
    expect(createSessionMock.mock.calls.map(([sessionId]) => sessionId)).toContainAllValues([
      failing.id,
      succeeding.id,
    ]);
    expect(consoleError).toHaveBeenCalledTimes(1);

    await runSchedulerTick();
    expect(createSessionMock).toHaveBeenCalledTimes(2);
  });
});

async function createAutomation(overrides: Partial<AutomationOptions> = {}): Promise<Automation> {
  return automationDatabase.create({
    title: "Repository summary",
    prompt: "Summarize repository status.",
    model: { name: "gpt-5" },
    cron: "0 9 * * *",
    ...overrides,
  });
}

function holdCompletion(): {
  resolve: (completion: {
    status: "completed" | "failed" | "timed_out";
    response?: string;
  }) => void;
} {
  let resolve!: (completion: {
    status: "completed" | "failed" | "timed_out";
    response?: string;
  }) => void;
  const completion = new Promise<{
    status: "completed" | "failed" | "timed_out";
    response?: string;
  }>((accept) => {
    resolve = accept;
  });
  create = async () => ({
    disposition: "started",
    waitForCompletion: () => completion,
  });
  return { resolve };
}

function readAutomationEvents(): AutomationEvent[] {
  return emitAutomationEventMock.mock.calls.map(([event]) => event);
}

async function waitForAutomationEvents(count: number): Promise<void> {
  await waitFor(() => readAutomationEvents().length >= count);
  expect(readAutomationEvents()).toHaveLength(count);
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !condition(); attempt++) {
    await Bun.sleep(1);
  }
  expect(condition()).toBe(true);
}
