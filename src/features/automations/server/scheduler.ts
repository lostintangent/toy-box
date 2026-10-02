// Claims scheduled work and dispatches it through the automation lifecycle.

import { broadcast } from "@workspace/server/events";
import { getStateDatabase } from "@/server/database";
import { AutomationDatabase } from "./database";
import { runAutomation } from "./index";

const POLL_INTERVAL_MS = 30_000;

export function startScheduler(): void {
  setInterval(() => void runSchedulerTick(), POLL_INTERVAL_MS).unref?.();
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
