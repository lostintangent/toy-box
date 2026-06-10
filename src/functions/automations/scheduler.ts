// Automation scheduler: polls for due automations and executes them.
//
// Each run creates a fresh session unless reuseSession points at an idle
// previous run session. The scheduler also exposes `runAutomation` for
// on-demand manual runs from the UI.

import type { CopilotSession } from "@github/copilot-sdk";
import { deleteSession } from "@/functions/state/sessionCache";
import { createManagedSession, startManagedSessionTurn } from "@/functions/runtime/sessionLauncher";
import { SessionStream } from "@/functions/runtime/stream";
import { getSdkStreamTerminalDisposition } from "@/functions/sdk/projector";
import { createAutomationRunSessionId } from "@/lib/automation/sessionId";
import type { Automation } from "@/types";
import { getAppDatabase } from "@/functions/database";
import { AutomationDatabase } from "./database";
import { emitAutomationsUpdate } from "./events";

const AUTOMATION_SCHEDULER_POLL_MS = 30_000;

export type AutomationRunResult = {
  sessionId: string;
  started: boolean;
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
): Promise<AutomationRunResult> {
  const automation = await db.getById(automationId);
  if (!automation) {
    throw new Error("Automation not found");
  }

  const reusedSessionId = automation.reuseSession ? automation.lastRunSessionId : undefined;
  if (reusedSessionId && SessionStream.isRunning(reusedSessionId)) {
    return { sessionId: reusedSessionId, started: false };
  }

  const sessionId = reusedSessionId ?? createAutomationRunSessionId(automation.id);

  if (reusedSessionId) {
    await deleteSession(sessionId);
  }

  const sessionHandle = await createManagedSession({
    sessionId,
    modelConfiguration: automation.modelConfiguration,
    directory: automation.cwd,
    summary: automation.title,
  });

  // Persist the session ID immediately so the automation list item is clickable
  // and the session can be filtered from the regular session list while running.
  await db.updateLastRunSessionId(automation.id, sessionId);

  emitAutomationsUpdate({
    type: "automation.started",
    automationId: automation.id,
    sessionId,
    startedAt: new Date().toISOString(),
  });

  const stopCompletionObserver = observeRunCompletion(db, {
    automationId: automation.id,
    sessionId,
    session: sessionHandle.session,
  });

  try {
    await startManagedSessionTurn(sessionHandle, automation.prompt);

    return { sessionId, started: true };
  } catch (error) {
    stopCompletionObserver();
    await finalizeAutomationRun(db, {
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
  db: AutomationDatabase,
  options: {
    automationId: string;
    sessionId: string;
    session: CopilotSession;
  },
): () => void {
  let settled = false;

  const unsubscribe = options.session.on((event) => {
    const terminalDisposition = getSdkStreamTerminalDisposition(event.type);
    if (!terminalDisposition || settled) return;

    settled = true;
    unsubscribe();
    void finalizeAutomationRun(db, {
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
  db: AutomationDatabase,
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
    await db.updateLastRun(options.automationId, finishedAt, options.sessionId);
    updatedAutomation = (await db.getById(options.automationId)) ?? undefined;
  }

  emitAutomationsUpdate({
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
