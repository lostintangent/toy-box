// Boot-time server state: the work this process does once, independently of any
// client connecting. Each task is isolated so one failure cannot skip the rest.

import { installBundledSkills } from "@sessions/server/sdk/bundledSkills";
import { startCopilotClient } from "@sessions/server/sdk/client";
import { retainSessionSnapshots } from "@sessions/server/state/snapshots";
import { getSettings } from "@workspace/server/state/settings";
import { terminalRuntime } from "@terminal/server/runtime";
import { definePlugin } from "nitro";

const featureSkillFiles = import.meta.glob<string>("../../features/*/server/skills/**/*", {
  eager: true,
  import: "default",
  query: "?raw",
});
const featureStartups = import.meta.glob<() => void | Promise<unknown>>(
  "../../features/*/server/startup.ts",
  { eager: true, import: "default" },
);

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("close", () => terminalRuntime.dispose());

  // Keep Toy Box-owned skills and their bundled resources current on disk.
  start("install bundled skills", () => installBundledSkills(featureSkillFiles));

  // Start the shared SDK process before the first session-list request needs it.
  start("start the Copilot client", startCopilotClient);

  // Make sure we retain snapshots for pinned sessions
  start("retain pinned session snapshots", async () =>
    retainSessionSnapshots((await getSettings()).pinnedSessionIds),
  );

  for (const [path, run] of Object.entries(featureStartups)) {
    start(`run ${path}`, run);
  }
});

function start(description: string, run: () => void | Promise<unknown>): void {
  void (async () => run())().catch((error) =>
    console.error(`Unable to ${description} on startup:`, error),
  );
}
