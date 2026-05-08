import type { CopilotSession } from "@github/copilot-sdk";
import { describe, expect, mock, onTestFinished, test } from "bun:test";
import type { Automation, AutomationsUpdateEvent } from "@/types";
import type { AutomationDatabase } from "./database";

type SessionTerminalDisposition = "idle" | "error";
type SessionEvent = {
  type: string;
};
type ManagedSessionOptions = {
  sessionId: string;
  model?: string;
  directory?: string;
  summary?: string;
};
type ManagedSessionHandle = {
  sessionId: string;
  session: CopilotSession;
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
    model: overrides.model ?? "gpt-5",
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

function createFakeSession() {
  const listeners = new Set<(event: SessionEvent) => void>();

  const session = {
    on(listener: (event: SessionEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as CopilotSession;

  return {
    session,
    emit(type: string) {
      for (const listener of Array.from(listeners)) {
        listener({ type });
      }
    },
  };
}

function resolveTerminalDisposition(type: string): SessionTerminalDisposition | undefined {
  if (type === "session.idle") return "idle";
  if (type === "session.error") return "error";
  return undefined;
}

async function flushAsyncEffects(): Promise<void> {
  await Bun.sleep(1);
}

function buildCreateManagedSessionMock(session: CopilotSession) {
  return mock(async (options: ManagedSessionOptions) => ({
    sessionId: options.sessionId,
    session,
  }));
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
  deleteSession?: (sessionId: string) => Promise<void>;
  createManagedSession?: (options: ManagedSessionOptions) => Promise<ManagedSessionHandle>;
  startManagedSessionTurn?: (sessionHandle: ManagedSessionHandle, prompt: string) => Promise<void>;
  emitAutomationsUpdate?: (event: AutomationsUpdateEvent) => void;
  getSdkStreamTerminalDisposition?: (type: string) => SessionTerminalDisposition | undefined;
}) {
  mock.module("@/functions/state/sessionCache", () => ({
    createSession: async () => {
      throw new Error("createSession should not be used by scheduler tests");
    },
    deleteSession: options.deleteSession ?? (async () => {}),
  }));
  mock.module("@/functions/runtime/sessionLauncher", () => ({
    createManagedSession:
      options.createManagedSession ??
      (async (launchOptions: ManagedSessionOptions) => ({
        sessionId: launchOptions.sessionId,
        session: createFakeSession().session,
      })),
    startManagedSessionTurn: options.startManagedSessionTurn ?? (async () => {}),
    createAndStartSession: async (launchOptions: {
      sessionId: string;
      prompt: string;
      model?: string;
      directory?: string;
      useWorktree?: boolean;
    }) => ({
      sessionId: launchOptions.sessionId,
      session: createFakeSession().session,
      stream: {
        startTurn: () => {},
        markSendFailure: () => {},
        detach: () => {},
      },
    }),
  }));
  mock.module("./events", () => ({
    emitAutomationsUpdate: options.emitAutomationsUpdate ?? (() => {}),
  }));
  mock.module("@/functions/sdk/projector", () => ({
    getSdkStreamTerminalDisposition:
      options.getSdkStreamTerminalDisposition ?? resolveTerminalDisposition,
  }));

  const scheduler = await import("./scheduler");

  return {
    ...scheduler,
    runAutomation: (automationId: string) =>
      scheduler.runAutomationWithDatabase(automationId, options.db),
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
    const createManagedSessionMock = buildCreateManagedSessionMock(createFakeSession().session);
    const startManagedSessionTurnMock = mock(
      async (_sessionHandle: ManagedSessionHandle, _prompt: string) => {},
    );

    const { runAutomation } = await loadScheduler({
      db: createFakeDb({
        getById: async () => automation,
        updateLastRunSessionId: updateLastRunSessionIdMock,
      }),
      deleteSession: deleteSessionMock,
      createManagedSession: createManagedSessionMock,
      startManagedSessionTurn: startManagedSessionTurnMock,
    });

    const result = await runAutomation(automation.id);

    expect(result).toEqual({ sessionId: "session-reused" });
    expect(deleteSessionMock).toHaveBeenCalledWith("session-reused");
    expect(createManagedSessionMock).toHaveBeenCalledWith({
      sessionId: "session-reused",
      model: "gpt-5",
      directory: "/repo/automation",
      summary: "Daily summary",
    });
    expectPersistedLastRunSession(updateLastRunSessionIdMock, automation.id, "session-reused");
    expect(startManagedSessionTurnMock).toHaveBeenCalledTimes(1);
    const [sessionHandle, prompt] = startManagedSessionTurnMock.mock.calls[0]!;
    expect(sessionHandle.sessionId).toBe("session-reused");
    expect(prompt).toBe("run with reuse");
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
    const createManagedSessionMock = buildCreateManagedSessionMock(createFakeSession().session);
    const startManagedSessionTurnMock = mock(
      async (_sessionHandle: ManagedSessionHandle, _prompt: string) => {},
    );

    const { runAutomation } = await loadScheduler({
      db: createFakeDb({
        getById: async () => automation,
        updateLastRunSessionId: updateLastRunSessionIdMock,
      }),
      createManagedSession: createManagedSessionMock,
      startManagedSessionTurn: startManagedSessionTurnMock,
    });

    const result = await runAutomation(automation.id);

    expect(createManagedSessionMock).toHaveBeenCalledTimes(1);
    const [launchOptions] = createManagedSessionMock.mock.calls[0]!;
    expect(launchOptions.sessionId).toStartWith("toy-box-auto-reuse-no-prior--run-");
    expect(launchOptions.model).toBe(automation.model);
    expect(launchOptions.summary).toBe(automation.title);
    expect(result.sessionId).toBe(launchOptions.sessionId);
    expectPersistedLastRunSession(
      updateLastRunSessionIdMock,
      automation.id,
      launchOptions.sessionId,
    );
    expect(startManagedSessionTurnMock).toHaveBeenCalledTimes(1);
    const [sessionHandle, prompt] = startManagedSessionTurnMock.mock.calls[0]!;
    expect(sessionHandle.sessionId).toBe(launchOptions.sessionId);
    expect(prompt).toBe("first run");
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
    const fakeSession = createFakeSession();
    const updateLastRunSessionIdMock = mock(
      async (_automationId: string, _sessionId: string) => {},
    );
    const updateLastRunMock = mock(
      async (_automationId: string, _runDate: Date, _sessionId: string) => {},
    );
    const createManagedSessionMock = buildCreateManagedSessionMock(fakeSession.session);
    const startManagedSessionTurnMock = mock(
      async (_sessionHandle: ManagedSessionHandle, _prompt: string) => {},
    );
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
      createManagedSession: createManagedSessionMock,
      startManagedSessionTurn: startManagedSessionTurnMock,
      emitAutomationsUpdate: emitAutomationsUpdateMock,
    });

    const result = await runAutomation(automation.id);

    expect(result).toEqual({ sessionId: "session-success" });
    const [launchOptions] = createManagedSessionMock.mock.calls[0]!;
    expect(launchOptions.sessionId).toBe("session-success");
    expect(launchOptions.model).toBe(automation.model);
    expect(launchOptions.summary).toBe(automation.title);
    expectPersistedLastRunSession(updateLastRunSessionIdMock, automation.id, "session-success");
    expect(startManagedSessionTurnMock).toHaveBeenCalledTimes(1);
    let emittedEvents = readEmittedAutomationEvents(emitAutomationsUpdateMock);
    expect(emittedEvents).toHaveLength(1);
    expectStartedAutomationEvent(emittedEvents[0], automation.id, "session-success");

    fakeSession.emit("session.idle");
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
    const fakeSession = createFakeSession();
    const updateLastRunSessionIdMock = mock(
      async (_automationId: string, _sessionId: string) => {},
    );
    const updateLastRunMock = mock(
      async (_automationId: string, _runDate: Date, _sessionId: string) => {},
    );
    const createManagedSessionMock = buildCreateManagedSessionMock(fakeSession.session);
    const startManagedSessionTurnMock = mock(
      async (_sessionHandle: ManagedSessionHandle, _prompt: string) => {},
    );
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
      createManagedSession: createManagedSessionMock,
      startManagedSessionTurn: startManagedSessionTurnMock,
      emitAutomationsUpdate: emitAutomationsUpdateMock,
    });

    const result = await runAutomation(automation.id);

    expect(result).toEqual({ sessionId: "session-failure" });
    const [launchOptions] = createManagedSessionMock.mock.calls[0]!;
    expect(launchOptions.sessionId).toBe("session-failure");
    expect(launchOptions.model).toBe(automation.model);
    expect(launchOptions.summary).toBe(automation.title);
    expectPersistedLastRunSession(updateLastRunSessionIdMock, automation.id, "session-failure");
    expect(startManagedSessionTurnMock).toHaveBeenCalledTimes(1);
    let emittedEvents = readEmittedAutomationEvents(emitAutomationsUpdateMock);
    expect(emittedEvents).toHaveLength(1);
    expectStartedAutomationEvent(emittedEvents[0], automation.id, "session-failure");

    fakeSession.emit("session.error");
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
    const fakeSession = createFakeSession();
    const updateLastRunSessionIdMock = mock(
      async (_automationId: string, _sessionId: string) => {},
    );
    const updateLastRunMock = mock(
      async (_automationId: string, _runDate: Date, _sessionId: string) => {},
    );
    const createManagedSessionMock = buildCreateManagedSessionMock(fakeSession.session);
    const startManagedSessionTurnMock = mock(
      async (_sessionHandle: ManagedSessionHandle, _prompt: string) => {},
    );
    startManagedSessionTurnMock.mockRejectedValue(new Error("boom"));
    const emitAutomationsUpdateMock = mock((_event: AutomationsUpdateEvent) => {});

    const { runAutomation } = await loadScheduler({
      db: createFakeDb({
        getById: async () => automation,
        updateLastRunSessionId: updateLastRunSessionIdMock,
        updateLastRun: updateLastRunMock,
      }),
      createManagedSession: createManagedSessionMock,
      startManagedSessionTurn: startManagedSessionTurnMock,
      emitAutomationsUpdate: emitAutomationsUpdateMock,
    });

    await expect(runAutomation(automation.id)).rejects.toThrow("boom");

    expect(updateLastRunMock).toHaveBeenCalledTimes(0);
    const [launchOptions] = createManagedSessionMock.mock.calls[0]!;
    expect(launchOptions.sessionId).toBe("session-send-failure");
    expect(launchOptions.model).toBe(automation.model);
    expect(launchOptions.summary).toBe(automation.title);
    expectPersistedLastRunSession(
      updateLastRunSessionIdMock,
      automation.id,
      "session-send-failure",
    );
    expect(startManagedSessionTurnMock).toHaveBeenCalledTimes(1);
    const emittedEvents = readEmittedAutomationEvents(emitAutomationsUpdateMock);
    expect(emittedEvents).toHaveLength(2);
    expectStartedAutomationEvent(emittedEvents[0], automation.id, "session-send-failure");
    expectFinishedAutomationEvent(emittedEvents[1], {
      automationId: automation.id,
      sessionId: "session-send-failure",
      success: false,
    });

    fakeSession.emit("session.idle");
    await flushAsyncEffects();

    expect(readEmittedAutomationEvents(emitAutomationsUpdateMock)).toHaveLength(2);
  });
});
