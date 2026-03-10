// Automation scheduler: polls for due automations and executes them.
//
// Each run creates a fresh session (even when reuseSession is enabled,
// which simply reuses the previous session ID). The scheduler also
// exposes `runAutomation` for on-demand manual runs from the UI.

import type { CopilotSession } from "@github/copilot-sdk";
import { createSession, deleteSession } from "@/functions/state/sessionCache";
import { updateSessionSummary } from "@/functions/runtime/broadcast";
import { SessionStream } from "@/functions/runtime/stream";
import { getSdkStreamTerminalDisposition } from "@/functions/sdk/projector";
import { createAutomationRunSessionId } from "@/lib/automation/sessionId";
import type { Automation } from "@/types";
import { getAppDatabase } from "@/functions/database";
import { AutomationDatabase } from "./database";
import { emitAutomationsUpdate } from "./events";

const AUTOMATION_SCHEDULER_POLL_MS = 30_000;

type AutomationSchedulerDependencies = {
  db: AutomationDatabase;
  deleteSession: typeof deleteSession;
  createSession: typeof createSession;
  updateSessionSummary: typeof updateSessionSummary;
  getOrCreateStream: (
    sessionId: string,
    session: CopilotSession,
    initialModel?: string,
  ) => SessionStream;
  emitAutomationsUpdate: typeof emitAutomationsUpdate;
  getSdkStreamTerminalDisposition: typeof getSdkStreamTerminalDisposition;
};

async function resolveDefaultDependencies(): Promise<AutomationSchedulerDependencies> {
  return {
    db: new AutomationDatabase(await getAppDatabase()),
    deleteSession,
    createSession,
    updateSessionSummary,
    getOrCreateStream: (sessionId, session, initialModel) =>
      SessionStream.getOrCreate(sessionId, session, initialModel),
    emitAutomationsUpdate,
    getSdkStreamTerminalDisposition,
  };
}

let activeDependencies: AutomationSchedulerDependencies | undefined;

/** Ensure the scheduler's polling loop is started */
let started = false;
export function ensureSchedulerStarted() {
  if (started) return;
  started = true;

  scheduleNextTick();
}

/** Poll for due automations and run them. */
let tickInProgress = false;
export async function runSchedulerTick() {
  if (tickInProgress) return;
  tickInProgress = true;

  try {
    const dependencies = activeDependencies ?? (await resolveDefaultDependencies());
    activeDependencies = dependencies;
    const dueAutomations = await dependencies.db.claimDue();
    for (const automation of dueAutomations) {
      try {
        await runAutomation(automation.id);
      } catch (error) {
        console.error(`Failed to run scheduled automation ${automation.id}:`, error);
      }
    }
  } finally {
    tickInProgress = false;
    scheduleNextTick();
  }
}

/** Create a fresh session for an automation and send its prompt. */
export async function runAutomation(automationId: string): Promise<{ sessionId: string }> {
  const dependencies = activeDependencies ?? (await resolveDefaultDependencies());
  activeDependencies = dependencies;
  const automation = await dependencies.db.getById(automationId);
  if (!automation) {
    throw new Error("Automation not found");
  }

  const sessionExists = automation.reuseSession && automation.lastRunSessionId;
  const sessionId = sessionExists
    ? automation.lastRunSessionId!
    : createAutomationRunSessionId(automation.id);

  if (sessionExists) {
    await dependencies.deleteSession(sessionId);
  }

  const session = await dependencies.createSession(sessionId, {
    model: automation.model,
    directory: automation.cwd,
  });

  dependencies.updateSessionSummary(sessionId, automation.title, { replace: true });
  const stream = dependencies.getOrCreateStream(sessionId, session);

  // Persist the session ID immediately so the automation list item is clickable
  // and the session can be filtered from the regular session list while running.
  await dependencies.db.updateLastRunSessionId(automation.id, sessionId);

  dependencies.emitAutomationsUpdate({
    type: "automation.started",
    automationId: automation.id,
    sessionId,
    startedAt: new Date().toISOString(),
  });

  const stopCompletionObserver = observeRunCompletion(dependencies, {
    automationId: automation.id,
    sessionId,
    session,
  });

  try {
    stream.startTurn(automation.prompt);

    session.send({
      prompt: automation.prompt,
    });

    return { sessionId };
  } catch (error) {
    stopCompletionObserver();
    stream.markSendFailure();
    stream.detach();
    await finalizeAutomationRun(dependencies, {
      automationId: automation.id,
      sessionId,
      success: false,
      updateLastRun: false,
    });
    throw error;
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

/** Subscribe to session events and finalize the run on a terminal event. Returns a dispose function. */
function observeRunCompletion(
  dependencies: AutomationSchedulerDependencies,
  options: {
    automationId: string;
    sessionId: string;
    session: CopilotSession;
  },
): () => void {
  let settled = false;

  const unsubscribe = options.session.on((event) => {
    const terminalDisposition = dependencies.getSdkStreamTerminalDisposition(event.type);
    if (!terminalDisposition || settled) return;

    settled = true;
    unsubscribe();
    void finalizeAutomationRun(dependencies, {
      automationId: options.automationId,
      sessionId: options.sessionId,
      success: terminalDisposition === "idle",
      updateLastRun: true,
    }).catch((error) => {
      console.error(`Failed to finalize automation run ${options.automationId}:`, error);
    });
  });

  return () => {
    if (settled) return;
    settled = true;
    unsubscribe();
  };
}

/** Persist the run result and emit a finished event to connected clients. */
async function finalizeAutomationRun(
  dependencies: AutomationSchedulerDependencies,
  options: {
    automationId: string;
    sessionId: string;
    success: boolean;
    updateLastRun: boolean;
  },
): Promise<void> {
  const finishedAt = new Date();
  let updatedAutomation: Automation | undefined;

  if (options.updateLastRun) {
    await dependencies.db.updateLastRun(options.automationId, finishedAt, options.sessionId);
    updatedAutomation = (await dependencies.db.getById(options.automationId)) ?? undefined;
  }

  dependencies.emitAutomationsUpdate({
    type: "automation.finished",
    automationId: options.automationId,
    sessionId: options.sessionId,
    finishedAt: finishedAt.toISOString(),
    success: options.success,
    automation: updatedAutomation,
  });
}

let timer = null as ReturnType<typeof setTimeout> | null;
function scheduleNextTick(delayMs = AUTOMATION_SCHEDULER_POLL_MS) {
  if (timer) {
    clearTimeout(timer);
  }

  timer = setTimeout(runSchedulerTick, delayMs);
}

// ============================================================================
// Test Seams
// ============================================================================

export function setAutomationSchedulerDependenciesForTests(
  overrides?: Partial<AutomationSchedulerDependencies>,
): void {
  if (!overrides) {
    activeDependencies = undefined;
    return;
  }

  activeDependencies = {
    db: overrides.db ?? ({} as AutomationDatabase),
    deleteSession: overrides.deleteSession ?? deleteSession,
    createSession: overrides.createSession ?? createSession,
    updateSessionSummary: overrides.updateSessionSummary ?? updateSessionSummary,
    getOrCreateStream:
      overrides.getOrCreateStream ??
      ((sessionId, session, initialModel) =>
        SessionStream.getOrCreate(sessionId, session, initialModel)),
    emitAutomationsUpdate: overrides.emitAutomationsUpdate ?? emitAutomationsUpdate,
    getSdkStreamTerminalDisposition:
      overrides.getSdkStreamTerminalDisposition ?? getSdkStreamTerminalDisposition,
  };
}
