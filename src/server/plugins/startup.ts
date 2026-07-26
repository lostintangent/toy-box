// Boot-time server state: the work this process does once, independently of any
// client connecting. Each task is isolated so one failure cannot skip the rest.

import { ensureSchedulerStarted } from "@/functions/automations/scheduler";
import { ensureWorkersSwept } from "@/functions/runtime/workers";
import { retainSessionSnapshots } from "@/functions/state/session/snapshots";
import { getSettings } from "@/functions/state/workspace/settings";

export default function startupPlugin(): void {
  // Run any scheduled automations that were missed while the server was down
  start("start the automation scheduler", ensureSchedulerStarted);

  // Make sure we retain snapshots for pinned sessions
  start("retain pinned session snapshots", async () =>
    retainSessionSnapshots((await getSettings()).pinnedSessionIds),
  );

  // Look for any worker sessions that got disrupted/abandoned
  // and delete them, since worker sessions are meant to feel ephemeral.
  start("sweep abandoned workers", ensureWorkersSwept);
}

function start(description: string, run: () => void | Promise<void>): void {
  void (async () => run())().catch((error) =>
    console.error(`Unable to ${description} on startup:`, error),
  );
}
