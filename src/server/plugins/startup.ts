// Boot-time server state: the work this process does once, independently of any
// client connecting. Each task is isolated so one failure cannot skip the rest.

import { ensureSchedulerStarted } from "@/functions/automations/scheduler";
import { ensureWorkersSwept } from "@/functions/workers/supervisor";
import { installBundledSkills } from "@/functions/sdk/bundledSkills";
import { startCopilotClient } from "@/functions/sdk/client";
import { retainSessionSnapshots } from "@/functions/state/session/snapshots";
import { getSettings } from "@/functions/state/workspace/settings";
import { terminalRuntime } from "../terminal/runtime";
import { definePlugin } from "nitro";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("close", () => terminalRuntime.dispose());

  // Keep Toy Box-owned skills and their bundled resources current on disk.
  start("install bundled skills", installBundledSkills);

  // Start the shared SDK process before the first session-list request needs it.
  start("start the Copilot client", startCopilotClient);

  // Run any scheduled automations that were missed while the server was down
  start("start the automation scheduler", ensureSchedulerStarted);

  // Make sure we retain snapshots for pinned sessions
  start("retain pinned session snapshots", async () =>
    retainSessionSnapshots((await getSettings()).pinnedSessionIds),
  );

  // Ephemeral workers cannot resume without their process supervisor.
  start("sweep abandoned ephemeral workers", ensureWorkersSwept);
});

function start(description: string, run: () => void | Promise<unknown>): void {
  void (async () => run())().catch((error) =>
    console.error(`Unable to ${description} on startup:`, error),
  );
}
