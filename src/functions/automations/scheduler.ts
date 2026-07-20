// Runs automations on demand and polls for scheduled work. Both paths converge
// here so reset, overlap prevention, creation, and completion metadata follow
// one lifecycle.

import { deleteSessionIfExists } from "@/functions/state/session/registry";
import { createSession, SessionStream } from "@/functions/runtime/stream";
import type { SessionStreamCompletion } from "@/functions/runtime/stream";
import { broadcast } from "@/functions/runtime/broadcast";
import { sharedMap } from "@/functions/runtime/processState";
import { getAppDatabase } from "@/functions/state/database";
import { AutomationDatabase } from "./database";

const AUTOMATION_SCHEDULER_POLL_MS = 30_000;

let schedulerStarted = false;
let schedulerTickInProgress = false;
let schedulerTimer: ReturnType<typeof setTimeout> | undefined;
const pendingAutomationRuns =
  sharedMap<ReturnType<typeof beginAutomationRun>>("pending-automation-runs");

export function ensureSchedulerStarted(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  scheduleSchedulerTick(0);
}

export async function runSchedulerTick(): Promise<void> {
  if (schedulerTickInProgress) return;
  schedulerTickInProgress = true;

  try {
    const appDatabase = await getAppDatabase({ createIfMissing: false });
    if (!appDatabase) return;

    const database = new AutomationDatabase(appDatabase);
    for (const automation of await database.claimDue()) {
      // The claim durably advances nextRunAt, even when dispatch later fails.
      broadcast({ type: "automation.upserted", automation });
      try {
        await startAutomationRun(automation.id);
      } catch (error) {
        console.error(`Failed to run scheduled automation ${automation.id}:`, error);
      }
    }
  } catch (error) {
    console.error("Failed to run automation scheduler tick:", error);
  } finally {
    schedulerTickInProgress = false;
  }
}

export async function startAutomationRun(automationId: string) {
  const pending = pendingAutomationRuns.get(automationId);
  if (pending) {
    const { sessionId } = await pending;
    return { sessionId, started: false };
  }

  const run = beginAutomationRun(automationId);
  pendingAutomationRuns.set(automationId, run);

  try {
    return await run;
  } finally {
    pendingAutomationRuns.delete(automationId);
  }
}

async function beginAutomationRun(automationId: string) {
  const database = new AutomationDatabase(await getAppDatabase());
  const automation = await database.get(automationId);
  if (!automation) throw new Error("Automation not found");

  if (SessionStream.isRunning(automation.id)) {
    return { sessionId: automation.id, started: false };
  }

  await deleteSessionIfExists(automation.id);
  const receipt = await createSession(
    automation.id,
    {
      content: automation.prompt,
      model: automation.model,
    },
    {
      directory: automation.cwd,
      name: automation.title,
      sessionType: "automation",
    },
  );

  void superviseAutomationRun(database, automation.id, receipt.waitForCompletion).catch((error) => {
    console.error(`Failed to finalize automation run ${automation.id}:`, error);
  });
  return { sessionId: automation.id, started: true };
}

async function superviseAutomationRun(
  database: AutomationDatabase,
  automationId: string,
  waitForCompletion: () => Promise<SessionStreamCompletion>,
): Promise<void> {
  try {
    await waitForCompletion();
  } catch (error) {
    console.error(`Failed to observe automation run ${automationId}:`, error);
  }

  try {
    await database.recordRunFinish(automationId, new Date());
    const automation = await database.get(automationId);
    if (automation) {
      broadcast({ type: "automation.upserted", automation });
    }
  } catch (error) {
    console.error(`Failed to persist automation run ${automationId}:`, error);
  }
}

function scheduleSchedulerTick(delayMs = AUTOMATION_SCHEDULER_POLL_MS): void {
  if (schedulerTimer) clearTimeout(schedulerTimer);
  schedulerTimer = setTimeout(() => {
    void runSchedulerLoop();
  }, delayMs);
  schedulerTimer.unref?.();
}

async function runSchedulerLoop(): Promise<void> {
  await runSchedulerTick();
  if (schedulerStarted) scheduleSchedulerTick();
}
