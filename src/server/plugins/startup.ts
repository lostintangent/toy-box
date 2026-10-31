// Boot-time server state: the work this process does once, independently of any
// client connecting. Each task is isolated so one failure cannot skip the rest.

import { installBundledSkills } from "@sessions/server/bundledSkills";
import { definePlugin } from "nitro";

const featureSkillFiles = import.meta.glob<string>("../../features/*/server/skills/**/*", {
  eager: true,
  import: "default",
  query: "?raw",
});

const featureStartups = import.meta.glob<() => void | VoidFunction | Promise<void | VoidFunction>>(
  "../../features/*/server/startup.ts",
  { eager: true, import: "default" },
);

export default definePlugin((nitroApp) => {
  // Keep Toy Box-owned skills and their bundled resources current on disk.
  void start("install bundled skills", () => installBundledSkills(featureSkillFiles));

  for (const [path, run] of Object.entries(featureStartups)) {
    const started = start(`run ${path}`, run);
    nitroApp.hooks.hook("close", async () => (await started)?.());
  }
});

function start<Result>(
  description: string,
  run: () => Result | Promise<Result>,
): Promise<Result | void> {
  return (async () => run())().catch((error) =>
    console.error(`Unable to ${description} on startup:`, error),
  );
}
