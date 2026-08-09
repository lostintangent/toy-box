// Runs automations on demand and polls for scheduled work. Both paths share one
// lifecycle for reset, overlap prevention, creation, and completion metadata.

import { createSession, deleteSessionIfExists, isSessionRunning } from "@sessions/server/runtime";
import { broadcast } from "@workspace/server/events";
import { sharedMap } from "@/shared/server/processState";
import { getStateDatabase } from "@/server/database";
import type { SessionCompletion } from "@sessions/model";
import { AutomationDatabase } from "./database";

const POLL_INTERVAL_MS = 30_000;

const pendingAutomationRuns =
  sharedMap<ReturnType<typeof beginAutomationRun>>("pending-automation-runs");

export function startScheduler(): void {
  scheduleSchedulerTick(0);
}

export async function runSchedulerTick(): Promise<void> {
  try {
    const appDatabase = await getStateDatabase({ createIfMissing: false });
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
  const database = new AutomationDatabase(await getStateDatabase());
  const automation = await database.get(automationId);
  if (!automation) throw new Error("Automation not found");

  if (isSessionRunning(automation.id)) {
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
  waitForCompletion: () => Promise<SessionCompletion>,
): Promise<void> {
  try {
    await waitForCompletion();
  } catch (error) {
    console.error(`Failed to await automation run ${automationId}:`, error);
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

function scheduleSchedulerTick(delayMs = POLL_INTERVAL_MS): void {
  const timer = setTimeout(() => void runSchedulerLoop(), delayMs);
  timer.unref?.();
}

async function runSchedulerLoop(): Promise<void> {
  await runSchedulerTick();
  scheduleSchedulerTick();
}
