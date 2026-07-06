import { describe, expect, mock, onTestFinished, test } from "bun:test";
import type {
  Automation,
  AutomationsUpdateEvent,
  ModelConfiguration,
  QueuedMessage,
} from "@/types";
import type { AutomationDatabase } from "./database";
import type { AutomationSchedulerDependencies } from "./scheduler";

type CreateSessionOptions = {
  modelConfiguration?: ModelConfiguration;
  directory?: string;
  automationId?: string;
};
type DeliverSessionMessageOptions = {
  sessionId: string;
  message: QueuedMessage;
};
type MockCallReader<Args extends readonly unknown[]> = {
  mock: {
    calls: ReadonlyArray<Args>;
  };
};

function createAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: overrides.id ?? "automation-1",
    title: overrides.title ?? "Daily summary",
    prompt: overrides.prompt ?? "Summarize repository status.",
    modelConfiguration: overrides.modelConfiguration ?? { model: "gpt-5" },
    cron: overrides.cron ?? "0 9 * * *",
    reuseSession: overrides.reuseSession ?? true,
    cwd: overrides.cwd,
    createdAt: overrides.createdAt ?? "2026-02-14T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-02-14T10:00:00.000Z",
    nextRunAt: overrides.nextRunAt ?? "2026-02-15T09:00:00.000Z",
    lastRunAt: overrides.lastRunAt,
    lastRunSessionId: "lastRunSessionId" in overrides ? overrides.lastRunSessionId : "session-1",
  };
}

async function flushAsyncEffects(): Promise<void> {
  await Bun.sleep(1);
}

function createDeliveryMock() {
  let resolveCompletion!: (result: { response?: string; error?: string }) => void;
  const completionPromise = new Promise<{ response?: string; error?: string }>((resolve) => {
    resolveCompletion = resolve;
  });
  const deliverSessionMessageMock = mock(async (options: DeliverSessionMessageOptions) => ({
    sessionId: options.sessionId,
    disposition: "sent" as const,
    completion: () => completionPromise,
  }));
  return {
    deliverSessionMessageMock,
    complete: (result: { response?: string; error?: string } = {}) => resolveCompletion(result),
  };
}

function mockCreateSession() {
  return mock(
    async (_sessionId: string, _options?: CreateSessionOptions) =>
      ({}) as Awaited<ReturnType<AutomationSchedulerDependencies["createSession"]>>,
  );
}

function readEmittedAutomationEvents(
  emitAutomationsUpdateMock: MockCallReader<readonly [AutomationsUpdateEvent]>,
): AutomationsUpdateEvent[] {
  return emitAutomationsUpdateMock.mock.calls.map(([event]) => event);
}

function expectPersistedLastRunSession(
  updateLastRunSessionIdMock: MockCallReader<readonly [string, string]>,
  automationId: string,
  sessionId: string,
): void {
  expect(updateLastRunSessionIdMock.mock.calls).toEqual([[automationId, sessionId]]);
}

function expectRecordedLastRun(
  updateLastRunMock: MockCallReader<readonly [string, Date, string]>,
  automationId: string,
  sessionId: string,
): void {
  expect(updateLastRunMock.mock.calls).toHaveLength(1);
  const [calledAutomationId, runDate, calledSessionId] = updateLastRunMock.mock.calls[0]!;
  expect(calledAutomationId).toBe(automationId);
  expect(runDate).toEqual(expect.any(Date));
  expect(calledSessionId).toBe(sessionId);
}

function expectStartedAutomationEvent(
  event: AutomationsUpdateEvent | undefined,
  automationId: string,
  sessionId: string,
): void {
  expect(event).toEqual({
    type: "automation.started",
    automationId,
    sessionId,
    startedAt: expect.any(String),
  });
}

function expectFinishedAutomationEvent(
  event: AutomationsUpdateEvent | undefined,
  options: {
    automationId: string;
    sessionId: string;
    success: boolean;
    automation?: Automation;
  },
): void {
  expect(event).toEqual({
    type: "automation.finished",
    automationId: options.automationId,
    sessionId: options.sessionId,
    finishedAt: expect.any(String),
    success: options.success,
    automation: options.automation,
  });
}

type AutomationDatabaseOverrides = Partial<
  Pick<
    AutomationDatabase,
    | "list"
    | "getById"
    | "create"
    | "update"
    | "remove"
    | "updateLastRunSessionId"
    | "updateLastRun"
    | "claimDue"
  >
>;

function createFakeDb(overrides: AutomationDatabaseOverrides = {}): AutomationDatabase {
  const fakeDb = {
    list: overrides.list ?? (async () => []),
    getById: overrides.getById ?? (async () => null),
    create: overrides.create ?? (async () => createAutomation()),
    update: overrides.update ?? (async () => null),
    remove: overrides.remove ?? (async () => true),
    updateLastRunSessionId: overrides.updateLastRunSessionId ?? (async () => {}),
    updateLastRun: overrides.updateLastRun ?? (async () => {}),
    claimDue: overrides.claimDue ?? (async () => []),
  };

  return fakeDb as unknown as AutomationDatabase;
}

async function loadScheduler(options: {
  db: AutomationDatabase;
  deleteSession?: AutomationSchedulerDependencies["deleteSession"];
  createSession?: AutomationSchedulerDependencies["createSession"];
  deliverSessionMessage?: AutomationSchedulerDependencies["deliverSessionMessage"];
  updateSessionName?: AutomationSchedulerDependencies["updateSessionName"];
  emitAutomationsUpdate?: AutomationSchedulerDependencies["emitAutomationsUpdate"];
  isSessionRunning?: AutomationSchedulerDependencies["isSessionRunning"];
}) {
  const scheduler = await import("./scheduler");
  const deps: AutomationSchedulerDependencies = {
    createSession:
      options.createSession ??
      (async () => ({}) as Awaited<ReturnType<AutomationSchedulerDependencies["createSession"]>>),
    deleteSession: options.deleteSession ?? (async () => {}),
    deliverSessionMessage:
      options.deliverSessionMessage ??
      (async (deliveryOptions) => ({
        sessionId: deliveryOptions.sessionId,
        disposition: "sent" as const,
        completion: async () => ({}),
      })),
    updateSessionName: options.updateSessionName ?? (() => {}),
    emitAutomationsUpdate: options.emitAutomationsUpdate ?? (() => {}),
    isSessionRunning: options.isSessionRunning ?? (() => false),
  };

  return {
    ...scheduler,
    runAutomation: (automationId: string) =>
      scheduler.runAutomationWithDatabase(automationId, options.db, deps),
  };
}

describe("automation scheduler", () => {
  test("reuses the last session ID when reuseSession is true", async () => {
    onTestFinished(() => {
      mock.restore();
    });

    const automation = createAutomation({
      id: "reuse-automation",
      prompt: "run with reuse",
      reuseSession: true,
      lastRunSessionId: "session-reused",
      cwd: "/repo/automation",
    });
    const deleteSessionMock = mock(async (_sessionId: string) => {});
    const updateLastRunSessionIdMock = mock(
      async (_automationId: string, _sessionId: string) => {},
    );
    const createSessionMock = mockCreateSession();
    const updateSessionNameMock = mock((_sessionId: string, _summary: string) => {});
    const { deliverSessionMessageMock } = createDeliveryMock();

    const { runAutomation } = await loadScheduler({
      db: createFakeDb({
        getById: async () => automation,
        updateLastRunSessionId: updateLastRunSessionIdMock,
      }),
      deleteSession: deleteSessionMock,
      createSession: createSessionMock,
      deliverSessionMessage: deliverSessionMessageMock,
      updateSessionName: updateSessionNameMock,
    });

    const result = await runAutomation(automation.id);

    expect(result).toEqual({ sessionId: "session-reused", started: true });
    expect(deleteSessionMock).toHaveBeenCalledWith("session-reused");
    expect(createSessionMock).toHaveBeenCalledWith("session-reused", {
      modelConfiguration: {
        model: "gpt-5",
      },
      directory: "/repo/automation",
      automationId: automation.id,
    });
    expect(updateSessionNameMock).toHaveBeenCalledWith("session-reused", "Daily summary");
    expectPersistedLastRunSession(updateLastRunSessionIdMock, automation.id, "session-reused");
    expect(deliverSessionMessageMock).toHaveBeenCalledTimes(1);
    expect(deliverSessionMessageMock).toHaveBeenCalledWith({
      sessionId: "session-reused",
      message: expect.objectContaining({
        role: "user",
        content: "run with reuse",
        modelConfiguration: automation.modelConfiguration,
      }),
    });
  });

  test("generates a new session ID when reuseSession is true but no prior session exists", async () => {
    onTestFinished(() => {
      mock.restore();
    });

    const automation = createAutomation({
      id: "reuse-no-prior",
      prompt: "first run",
      reuseSession: true,
      lastRunSessionId: undefined,
    });
    const updateLastRunSessionIdMock = mock(
      async (_automationId: string, _sessionId: string) => {},
    );
    const createSessionMock = mockCreateSession();
    const updateSessionNameMock = mock((_sessionId: string, _summary: string) => {});
    const { deliverSessionMessageMock } = createDeliveryMock();

    const { runAutomation } = await loadScheduler({
      db: createFakeDb({
        getById: async () => automation,
        updateLastRunSessionId: updateLastRunSessionIdMock,
      }),
      createSession: createSessionMock,
      deliverSessionMessage: deliverSessionMessageMock,
      updateSessionName: updateSessionNameMock,
    });

    const result = await runAutomation(automation.id);

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    const [createdSessionId, createOptions] = createSessionMock.mock.calls[0]!;
    expect(createdSessionId).toStartWith("toy-box-auto-reuse-no-prior--run-");
    expect(createOptions?.modelConfiguration).toEqual({
      model: automation.modelConfiguration.model,
    });
    expect(createOptions?.automationId).toBe(automation.id);
    expect(updateSessionNameMock).toHaveBeenCalledWith(createdSessionId, automation.title);
    expect(result.sessionId).toBe(createdSessionId);
    expect(result.started).toBe(true);
    expectPersistedLastRunSession(updateLastRunSessionIdMock, automation.id, createdSessionId);
    expect(deliverSessionMessageMock).toHaveBeenCalledWith({
      sessionId: createdSessionId,
      message: expect.objectContaining({
        role: "user",
        content: "first run",
        modelConfiguration: automation.modelConfiguration,
      }),
    });
  });

  test("does not delete or restart a reused session while it is still running", async () => {
    onTestFinished(() => {
      mock.restore();
    });

    const automation = createAutomation({
      id: "already-running-automation",
      reuseSession: true,
      lastRunSessionId: "session-running",
    });
    const deleteSessionMock = mock(async (_sessionId: string) => {});
    const updateLastRunSessionIdMock = mock(
      async (_automationId: string, _sessionId: string) => {},
    );
    const createSessionMock = mockCreateSession();
    const { deliverSessionMessageMock } = createDeliveryMock();
    const emitAutomationsUpdateMock = mock((_event: AutomationsUpdateEvent) => {});

    const { runAutomation } = await loadScheduler({
      db: createFakeDb({
        getById: async () => automation,
        updateLastRunSessionId: updateLastRunSessionIdMock,
      }),
      deleteSession: deleteSessionMock,
      createSession: createSessionMock,
      deliverSessionMessage: deliverSessionMessageMock,
      emitAutomationsUpdate: emitAutomationsUpdateMock,
      isSessionRunning: (sessionId) => sessionId === "session-running",
    });

    const result = await runAutomation(automation.id);

    expect(result).toEqual({ sessionId: "session-running", started: false });
    expect(deleteSessionMock).toHaveBeenCalledTimes(0);
    expect(createSessionMock).toHaveBeenCalledTimes(0);
    expect(updateLastRunSessionIdMock).toHaveBeenCalledTimes(0);
    expect(deliverSessionMessageMock).toHaveBeenCalledTimes(0);
    expect(emitAutomationsUpdateMock).toHaveBeenCalledTimes(0);
  });

  test("passes optional reasoning effort when launching an automation", async () => {
    onTestFinished(() => {
      mock.restore();
    });

    const automation = createAutomation({
      id: "reasoning-automation",
      modelConfiguration: { model: "gpt-5", reasoningEffort: "high" },
      reuseSession: false,
      lastRunSessionId: undefined,
    });
    const createSessionMock = mockCreateSession();
    const { deliverSessionMessageMock } = createDeliveryMock();

    const { runAutomation } = await loadScheduler({
      db: createFakeDb({
        getById: async () => automation,
        updateLastRunSessionId: async (_automationId: string, _sessionId: string) => {},
      }),
      createSession: createSessionMock,
      deliverSessionMessage: deliverSessionMessageMock,
    });

    await runAutomation(automation.id);

    const [, createOptions] = createSessionMock.mock.calls[0]!;
    expect(createOptions?.modelConfiguration?.reasoningEffort).toBe("high");
    expect(createOptions?.automationId).toBe(automation.id);
    const [deliveryOptions] = deliverSessionMessageMock.mock.calls[0]!;
    expect(deliveryOptions.message).toMatchObject({
      role: "user",
      modelConfiguration: { reasoningEffort: "high" },
    });
  });

  test("emits started then finished(success) and updates lastRunAt after idle terminal", async () => {
    onTestFinished(() => {
      mock.restore();
    });

    const automation = createAutomation({
      id: "success-automation",
      prompt: "run now",
      reuseSession: true,
      lastRunSessionId: "session-success",
    });
    const updatedAutomation = createAutomation({
      ...automation,
      lastRunAt: "2026-02-14T10:05:00.000Z",
      updatedAt: "2026-02-14T10:05:00.000Z",
    });
    const updateLastRunSessionIdMock = mock(
      async (_automationId: string, _sessionId: string) => {},
    );
    const updateLastRunMock = mock(
      async (_automationId: string, _runDate: Date, _sessionId: string) => {},
    );
    const createSessionMock = mockCreateSession();
    const updateSessionNameMock = mock((_sessionId: string, _summary: string) => {});
    const { deliverSessionMessageMock, complete } = createDeliveryMock();
    const emitAutomationsUpdateMock = mock((_event: AutomationsUpdateEvent) => {});

    let getCalls = 0;
    const { runAutomation } = await loadScheduler({
      db: createFakeDb({
        getById: async () => {
          getCalls += 1;
          return getCalls === 1 ? automation : updatedAutomation;
        },
        updateLastRunSessionId: updateLastRunSessionIdMock,
        updateLastRun: updateLastRunMock,
      }),
      createSession: createSessionMock,
      deliverSessionMessage: deliverSessionMessageMock,
      updateSessionName: updateSessionNameMock,
      emitAutomationsUpdate: emitAutomationsUpdateMock,
    });

    const result = await runAutomation(automation.id);

    expect(result).toEqual({ sessionId: "session-success", started: true });
    expect(createSessionMock).toHaveBeenCalledWith(
      "session-success",
      expect.objectContaining({
        modelConfiguration: automation.modelConfiguration,
        automationId: automation.id,
      }),
    );
    expect(updateSessionNameMock).toHaveBeenCalledWith("session-success", automation.title);
    expectPersistedLastRunSession(updateLastRunSessionIdMock, automation.id, "session-success");
    expect(deliverSessionMessageMock).toHaveBeenCalledWith({
      sessionId: "session-success",
      message: expect.objectContaining({
        role: "user",
        content: "run now",
        modelConfiguration: automation.modelConfiguration,
      }),
    });
    let emittedEvents = readEmittedAutomationEvents(emitAutomationsUpdateMock);
    expect(emittedEvents).toHaveLength(1);
    expectStartedAutomationEvent(emittedEvents[0], automation.id, "session-success");

    complete();
    await flushAsyncEffects();

    expectRecordedLastRun(updateLastRunMock, automation.id, "session-success");
    emittedEvents = readEmittedAutomationEvents(emitAutomationsUpdateMock);
    expect(emittedEvents).toHaveLength(2);
    expectFinishedAutomationEvent(emittedEvents[1], {
      automationId: automation.id,
      sessionId: "session-success",
      success: true,
      automation: updatedAutomation,
    });
  });

  test("emits started then finished(failure) and updates lastRunAt after error terminal", async () => {
    onTestFinished(() => {
      mock.restore();
    });

    const automation = createAutomation({
      id: "failed-automation",
      prompt: "run and fail",
      reuseSession: true,
      lastRunSessionId: "session-failure",
    });
    const updatedAutomation = createAutomation({
      ...automation,
      lastRunAt: "2026-02-14T10:06:00.000Z",
      updatedAt: "2026-02-14T10:06:00.000Z",
    });
    const updateLastRunSessionIdMock = mock(
      async (_automationId: string, _sessionId: string) => {},
    );
    const updateLastRunMock = mock(
      async (_automationId: string, _runDate: Date, _sessionId: string) => {},
    );
    const createSessionMock = mockCreateSession();
    const updateSessionNameMock = mock((_sessionId: string, _summary: string) => {});
    const { deliverSessionMessageMock, complete } = createDeliveryMock();
    const emitAutomationsUpdateMock = mock((_event: AutomationsUpdateEvent) => {});

    let getCalls = 0;
    const { runAutomation } = await loadScheduler({
      db: createFakeDb({
        getById: async () => {
          getCalls += 1;
          return getCalls === 1 ? automation : updatedAutomation;
        },
        updateLastRunSessionId: updateLastRunSessionIdMock,
        updateLastRun: updateLastRunMock,
      }),
      createSession: createSessionMock,
      deliverSessionMessage: deliverSessionMessageMock,
      updateSessionName: updateSessionNameMock,
      emitAutomationsUpdate: emitAutomationsUpdateMock,
    });

    const result = await runAutomation(automation.id);

    expect(result).toEqual({ sessionId: "session-failure", started: true });
    expect(createSessionMock).toHaveBeenCalledWith(
      "session-failure",
      expect.objectContaining({
        modelConfiguration: automation.modelConfiguration,
        automationId: automation.id,
      }),
    );
    expect(updateSessionNameMock).toHaveBeenCalledWith("session-failure", automation.title);
    expectPersistedLastRunSession(updateLastRunSessionIdMock, automation.id, "session-failure");
    expect(deliverSessionMessageMock).toHaveBeenCalledWith({
      sessionId: "session-failure",
      message: expect.objectContaining({
        role: "user",
        content: "run and fail",
        modelConfiguration: automation.modelConfiguration,
      }),
    });
    let emittedEvents = readEmittedAutomationEvents(emitAutomationsUpdateMock);
    expect(emittedEvents).toHaveLength(1);
    expectStartedAutomationEvent(emittedEvents[0], automation.id, "session-failure");

    complete({ error: "The session ended with an error." });
    await flushAsyncEffects();

    expectRecordedLastRun(updateLastRunMock, automation.id, "session-failure");
    emittedEvents = readEmittedAutomationEvents(emitAutomationsUpdateMock);
    expect(emittedEvents).toHaveLength(2);
    expectFinishedAutomationEvent(emittedEvents[1], {
      automationId: automation.id,
      sessionId: "session-failure",
      success: false,
      automation: updatedAutomation,
    });
  });

  test("send failures finalize the run without updating lastRun", async () => {
    onTestFinished(() => {
      mock.restore();
    });

    const automation = createAutomation({
      id: "send-failure-automation",
      prompt: "run and fail before streaming",
      reuseSession: true,
      lastRunSessionId: "session-send-failure",
    });
    const updateLastRunSessionIdMock = mock(
      async (_automationId: string, _sessionId: string) => {},
    );
    const updateLastRunMock = mock(
      async (_automationId: string, _runDate: Date, _sessionId: string) => {},
    );
    const createSessionMock = mockCreateSession();
    const updateSessionNameMock = mock((_sessionId: string, _summary: string) => {});
    const deliverSessionMessageMock = mock(async (_options: DeliverSessionMessageOptions) => {
      throw new Error("boom");
    });
    const emitAutomationsUpdateMock = mock((_event: AutomationsUpdateEvent) => {});

    const { runAutomation } = await loadScheduler({
      db: createFakeDb({
        getById: async () => automation,
        updateLastRunSessionId: updateLastRunSessionIdMock,
        updateLastRun: updateLastRunMock,
      }),
      createSession: createSessionMock,
      deliverSessionMessage: deliverSessionMessageMock,
      updateSessionName: updateSessionNameMock,
      emitAutomationsUpdate: emitAutomationsUpdateMock,
    });

    await expect(runAutomation(automation.id)).rejects.toThrow("boom");

    expect(updateLastRunMock).toHaveBeenCalledTimes(0);
    expect(createSessionMock).toHaveBeenCalledWith(
      "session-send-failure",
      expect.objectContaining({
        modelConfiguration: automation.modelConfiguration,
        automationId: automation.id,
      }),
    );
    expect(updateSessionNameMock).toHaveBeenCalledWith("session-send-failure", automation.title);
    expectPersistedLastRunSession(
      updateLastRunSessionIdMock,
      automation.id,
      "session-send-failure",
    );
    expect(deliverSessionMessageMock).toHaveBeenCalledTimes(1);
    const emittedEvents = readEmittedAutomationEvents(emitAutomationsUpdateMock);
    expect(emittedEvents).toHaveLength(2);
    expectStartedAutomationEvent(emittedEvents[0], automation.id, "session-send-failure");
    expectFinishedAutomationEvent(emittedEvents[1], {
      automationId: automation.id,
      sessionId: "session-send-failure",
      success: false,
    });

    await flushAsyncEffects();

    expect(readEmittedAutomationEvents(emitAutomationsUpdateMock)).toHaveLength(2);
  });
});
