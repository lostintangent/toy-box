// Claims scheduled work and dispatches it through the automation lifecycle.

import { broadcast } from "@workspace/server/events";
import { getStateDatabase } from "@/server/database";
import { AutomationDatabase } from "./database";
import { runAutomation } from "./index";

const POLL_INTERVAL_MS = 30_000;

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
        await runAutomation(automation.id);
      } catch (error) {
        console.error(`Failed to run scheduled automation ${automation.id}:`, error);
      }
    }
  } catch (error) {
    console.error("Failed to run automation scheduler tick:", error);
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
