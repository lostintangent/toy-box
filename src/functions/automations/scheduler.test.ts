import type { CopilotSession } from "@github/copilot-sdk";
import { describe, expect, onTestFinished, test } from "bun:test";
import type { Automation, AutomationsUpdateEvent } from "@/types";
import type { SessionStream } from "@/functions/runtime/stream";
import type { AutomationDatabase } from "./database";
import { runAutomation, setAutomationSchedulerDependenciesForTests } from "./scheduler";

type SessionTerminalDisposition = "idle" | "error";
type SessionEvent = {
  type: string;
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

function createFakeSession(options?: { sendError?: Error }) {
  const listeners = new Set<(event: SessionEvent) => void>();
  const sentPrompts: string[] = [];

  const session = {
    send(input: { prompt: string }) {
      sentPrompts.push(input.prompt);
      if (options?.sendError) {
        throw options.sendError;
      }
    },
    on(listener: (event: SessionEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as CopilotSession;

  return {
    session,
    sentPrompts,
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

function createFakeDb(overrides: Partial<AutomationDatabase> = {}): AutomationDatabase {
  return {
    list: overrides.list ?? (async () => []),
    getById: overrides.getById ?? (async () => null),
    create: overrides.create ?? (async () => createAutomation()),
    update: overrides.update ?? (async () => null),
    remove: overrides.remove ?? (async () => true),
    updateLastRun: overrides.updateLastRun ?? (async () => {}),
    claimDue: overrides.claimDue ?? (async () => []),
    close: overrides.close ?? (() => {}),
  } as AutomationDatabase;
}

function createFakeStream(): SessionStream {
  return {
    resetForNewTurn: () => {},
    emit: () => {},
    markSendFailure: () => {},
    detach: () => {},
  } as unknown as SessionStream;
}

describe("automation scheduler", () => {
  test("reuses the last session ID when reuseSession is true", async () => {
    onTestFinished(() => {
      setAutomationSchedulerDependenciesForTests();
    });

    const automation = createAutomation({
      id: "reuse-automation",
      prompt: "run with reuse",
      reuseSession: true,
      lastRunSessionId: "session-reused",
    });
    const fakeSession = createFakeSession();
    const createdSessions: Array<{ sessionId: string; model: string }> = [];

    setAutomationSchedulerDependenciesForTests({
      db: createFakeDb({
        getById: async () => automation,
      }),
      deleteSession: async () => {},
      createSession: async (sessionId, model) => {
        createdSessions.push({ sessionId, model: model ?? "" });
        return fakeSession.session;
      },
      updateSessionSummary: () => {},
      getOrCreateStream: () => createFakeStream(),
      emitAutomationsUpdate: () => {},
      getSdkStreamTerminalDisposition: resolveTerminalDisposition,
    });

    const result = await runAutomation(automation.id);

    expect(result).toEqual({ sessionId: "session-reused" });
    expect(createdSessions).toEqual([{ sessionId: "session-reused", model: "gpt-5" }]);
    expect(fakeSession.sentPrompts).toEqual(["run with reuse"]);
  });

  test("generates a new session ID when reuseSession is true but no prior session exists", async () => {
    onTestFinished(() => {
      setAutomationSchedulerDependenciesForTests();
    });

    const automation = createAutomation({
      id: "reuse-no-prior",
      prompt: "first run",
      reuseSession: true,
      lastRunSessionId: undefined,
    });
    const fakeSession = createFakeSession();
    const createdSessionIds: string[] = [];

    setAutomationSchedulerDependenciesForTests({
      db: createFakeDb({
        getById: async () => automation,
      }),
      deleteSession: async () => {},
      createSession: async (sessionId) => {
        createdSessionIds.push(sessionId);
        return fakeSession.session;
      },
      updateSessionSummary: () => {},
      getOrCreateStream: () => createFakeStream(),
      emitAutomationsUpdate: () => {},
      getSdkStreamTerminalDisposition: resolveTerminalDisposition,
    });

    const result = await runAutomation(automation.id);

    expect(createdSessionIds).toHaveLength(1);
    expect(createdSessionIds[0]).toStartWith("toy-box-auto-reuse-no-prior--run-");
    expect(result.sessionId).toBe(createdSessionIds[0]);
  });

  test("emits started then finished(success) and updates lastRunAt after idle terminal", async () => {
    onTestFinished(() => {
      setAutomationSchedulerDependenciesForTests();
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
    const events: AutomationsUpdateEvent[] = [];
    const updateLastRunCalls: Array<{ automationId: string; sessionId: string }> = [];

    let getCalls = 0;
    setAutomationSchedulerDependenciesForTests({
      db: createFakeDb({
        getById: async () => {
          getCalls += 1;
          return getCalls === 1 ? automation : updatedAutomation;
        },
        updateLastRun: async (automationId, _runDate, sessionId) => {
          updateLastRunCalls.push({ automationId, sessionId });
        },
      }),
      deleteSession: async () => {},
      createSession: async () => fakeSession.session,
      updateSessionSummary: () => {},
      getOrCreateStream: () => createFakeStream(),
      emitAutomationsUpdate: (event) => {
        events.push(event);
      },
      getSdkStreamTerminalDisposition: resolveTerminalDisposition,
    });

    const result = await runAutomation(automation.id);

    expect(result).toEqual({ sessionId: "session-success" });
    expect(fakeSession.sentPrompts).toEqual(["run now"]);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("automation.started");

    fakeSession.emit("session.idle");
    await flushAsyncEffects();

    expect(updateLastRunCalls).toEqual([
      {
        automationId: "success-automation",
        sessionId: "session-success",
      },
    ]);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      type: "automation.finished",
      automationId: "success-automation",
      sessionId: "session-success",
      finishedAt: expect.any(String),
      success: true,
      automation: updatedAutomation,
    });
  });

  test("emits started then finished(failure) and updates lastRunAt after error terminal", async () => {
    onTestFinished(() => {
      setAutomationSchedulerDependenciesForTests();
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
    const events: AutomationsUpdateEvent[] = [];
    const updateLastRunCalls: Array<{ automationId: string; sessionId: string }> = [];

    let getCalls = 0;
    setAutomationSchedulerDependenciesForTests({
      db: createFakeDb({
        getById: async () => {
          getCalls += 1;
          return getCalls === 1 ? automation : updatedAutomation;
        },
        updateLastRun: async (automationId, _runDate, sessionId) => {
          updateLastRunCalls.push({ automationId, sessionId });
        },
      }),
      deleteSession: async () => {},
      createSession: async () => fakeSession.session,
      updateSessionSummary: () => {},
      getOrCreateStream: () => createFakeStream(),
      emitAutomationsUpdate: (event) => {
        events.push(event);
      },
      getSdkStreamTerminalDisposition: resolveTerminalDisposition,
    });

    const result = await runAutomation(automation.id);

    expect(result).toEqual({ sessionId: "session-failure" });
    expect(fakeSession.sentPrompts).toEqual(["run and fail"]);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("automation.started");

    fakeSession.emit("session.error");
    await flushAsyncEffects();

    expect(updateLastRunCalls).toEqual([
      {
        automationId: "failed-automation",
        sessionId: "session-failure",
      },
    ]);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      type: "automation.finished",
      automationId: "failed-automation",
      sessionId: "session-failure",
      finishedAt: expect.any(String),
      success: false,
      automation: updatedAutomation,
    });
  });
});
