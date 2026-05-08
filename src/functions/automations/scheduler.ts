// Automation scheduler: polls for due automations and executes them.
//
// Each run creates a fresh session (even when reuseSession is enabled,
// which simply reuses the previous session ID). The scheduler also
// exposes `runAutomation` for on-demand manual runs from the UI.

import type { CopilotSession } from "@github/copilot-sdk";
import { deleteSession } from "@/functions/state/sessionCache";
import { createManagedSession, startManagedSessionTurn } from "@/functions/runtime/sessionLauncher";
import { getSdkStreamTerminalDisposition } from "@/functions/sdk/projector";
import { createAutomationRunSessionId } from "@/lib/automation/sessionId";
import type { Automation } from "@/types";
import { getAppDatabase } from "@/functions/database";
import { AutomationDatabase } from "./database";
import { emitAutomationsUpdate } from "./events";

const AUTOMATION_SCHEDULER_POLL_MS = 30_000;

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
    const db = new AutomationDatabase(await getAppDatabase());
    const dueAutomations = await db.claimDue();
    for (const automation of dueAutomations) {
      try {
        await runAutomationWithDatabase(automation.id, db);
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
  const db = new AutomationDatabase(await getAppDatabase());
  return runAutomationWithDatabase(automationId, db);
}

export async function runAutomationWithDatabase(
  automationId: string,
  db: AutomationDatabase,
): Promise<{ sessionId: string }> {
  const automation = await db.getById(automationId);
  if (!automation) {
    throw new Error("Automation not found");
  }

  const sessionExists = automation.reuseSession && automation.lastRunSessionId;
  const sessionId = sessionExists
    ? automation.lastRunSessionId!
    : createAutomationRunSessionId(automation.id);

  if (sessionExists) {
    await deleteSession(sessionId);
  }

  const sessionHandle = await createManagedSession({
    sessionId,
    model: automation.model,
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

    return { sessionId };
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
