// Boot-time server state: the work this process does once, independently of any
// client connecting. Each task is isolated so one failure cannot skip the rest.

import { installBundledSkills } from "@sessions/server/bundledSkills";
import { fileWatcher } from "@files/server/watcher";
import { refreshSessionArtifacts } from "@sessions/server/runtime";
import { listModels, stopProviders } from "@providers/server";
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
  nitroApp.hooks.hook("close", async () => {
    fileWatcher.dispose();
    terminalRuntime.dispose();
    await stopProviders();
  });

  // Keep Toy Box-owned skills and their bundled resources current on disk.
  start("install bundled skills", () => installBundledSkills(featureSkillFiles));

  start("observe session artifacts", () => {
    fileWatcher.observeArtifacts(refreshSessionArtifacts);
  });

  // Start the shared native processes before the first session-list request needs them.
  start("discover session providers", listModels);

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
