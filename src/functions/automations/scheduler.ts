// Automation scheduler: polls for due automations and executes them.
//
// Each run creates a fresh session unless reuseSession points at an idle
// previous run session. The scheduler also exposes `runAutomation` for
// on-demand manual runs from the UI.

import { createSession, deleteSession } from "@/functions/state/sessionRegistry";
import { deliverSessionMessage, SessionStream } from "@/functions/runtime/stream";
import { emitAutomationsUpdate, updateSessionName } from "@/functions/runtime/broadcast";
import { createAutomationRunSessionId } from "@/lib/automation/sessionId";
import type { Automation } from "@/types";
import { getAppDatabase } from "@/functions/database";
import { AutomationDatabase } from "./database";

const AUTOMATION_SCHEDULER_POLL_MS = 30_000;

export type AutomationRunResult = {
  sessionId: string;
  started: boolean;
};

export type AutomationSchedulerDependencies = {
  createSession: typeof createSession;
  deleteSession: typeof deleteSession;
  deliverSessionMessage: typeof deliverSessionMessage;
  updateSessionName: typeof updateSessionName;
  emitAutomationsUpdate: typeof emitAutomationsUpdate;
  isSessionRunning(sessionId: string): boolean;
};

const defaultSchedulerDependencies: AutomationSchedulerDependencies = {
  createSession,
  deleteSession,
  deliverSessionMessage,
  updateSessionName,
  emitAutomationsUpdate,
  isSessionRunning: (sessionId) => SessionStream.isRunning(sessionId),
};

/** Ensure the scheduler's polling loop is started */
let started = false;
export function ensureSchedulerStarted() {
  if (started) return;
  started = true;

  scheduleNextTick(0);
}

/** Poll for due automations and run them. */
let tickInProgress = false;
export async function runSchedulerTick() {
  if (tickInProgress) return;
  tickInProgress = true;

  try {
    const appDatabase = await getAppDatabase({ createIfMissing: false });
    if (!appDatabase) return;
    const db = new AutomationDatabase(appDatabase);
    const dueAutomations = await db.claimDue();
    for (const automation of dueAutomations) {
      try {
        await runAutomationWithDatabase(automation.id, db);
      } catch (error) {
        console.error(`Failed to run scheduled automation ${automation.id}:`, error);
      }
    }
  } catch (error) {
    console.error("Failed to run automation scheduler tick:", error);
  } finally {
    tickInProgress = false;
    scheduleNextTick();
  }
}

/** Create a fresh session for an automation and send its prompt. */
export async function runAutomation(automationId: string): Promise<AutomationRunResult> {
  const db = new AutomationDatabase(await getAppDatabase());
  return runAutomationWithDatabase(automationId, db);
}

export async function runAutomationWithDatabase(
  automationId: string,
  db: AutomationDatabase,
  deps = defaultSchedulerDependencies,
): Promise<AutomationRunResult> {
  const automation = await db.getById(automationId);
  if (!automation) {
    throw new Error("Automation not found");
  }

  const reusedSessionId = automation.reuseSession ? automation.lastRunSessionId : undefined;
  if (reusedSessionId && deps.isSessionRunning(reusedSessionId)) {
    return { sessionId: reusedSessionId, started: false };
  }

  const sessionId = reusedSessionId ?? createAutomationRunSessionId(automation.id);

  if (reusedSessionId) {
    await deps.deleteSession(sessionId);
  }

  await deps.createSession(sessionId, {
    modelConfiguration: automation.modelConfiguration,
    directory: automation.cwd,
    automationId: automation.id,
  });
  deps.updateSessionName(sessionId, automation.title);

  // Persist the session ID immediately so the automation list item is clickable
  // and the session can be filtered from the regular session list while running.
  await db.updateLastRunSessionId(automation.id, sessionId);

  deps.emitAutomationsUpdate({
    type: "automation.started",
    automationId: automation.id,
    sessionId,
    startedAt: new Date().toISOString(),
  });

  try {
    const receipt = await deps.deliverSessionMessage({
      sessionId,
      message: {
        id: crypto.randomUUID(),
        role: "user",
        content: automation.prompt,
        modelConfiguration: automation.modelConfiguration,
      },
    });
    void receipt
      .completion()
      .then((completion) =>
        finalizeAutomationRun(
          db,
          {
            automationId: automation.id,
            sessionId,
            success: !completion.error,
            updateLastRun: true,
          },
          deps,
        ),
      )
      .catch((error) => {
        console.error(`Failed to finalize automation run ${automation.id}:`, error);
      });

    return { sessionId, started: true };
  } catch (error) {
    await finalizeAutomationRun(
      db,
      {
        automationId: automation.id,
        sessionId,
        success: false,
        updateLastRun: false,
      },
      deps,
    );
    throw error;
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

/** Persist the run result and emit a finished event to connected clients. */
async function finalizeAutomationRun(
  db: AutomationDatabase,
  options: {
    automationId: string;
    sessionId: string;
    success: boolean;
    updateLastRun: boolean;
  },
  deps = defaultSchedulerDependencies,
): Promise<void> {
  const finishedAt = new Date();
  let updatedAutomation: Automation | undefined;

  if (options.updateLastRun) {
    await db.updateLastRun(options.automationId, finishedAt, options.sessionId);
    updatedAutomation = (await db.getById(options.automationId)) ?? undefined;
  }

  deps.emitAutomationsUpdate({
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
