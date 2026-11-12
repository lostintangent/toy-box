// Boot-time server state: the work this process does once, independently of any
// client connecting, and its cleanup when the server closes. Each task is isolated
// so one failure cannot skip the rest.

import { installBundledSkills } from "@sessions/server/bundledSkills";
import { definePlugin } from "nitro";
import { shutdown } from "@/shared/server/shutdown";

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
  void attempt("install bundled skills", () => installBundledSkills(featureSkillFiles));

  for (const [path, run] of Object.entries(featureStartups)) {
    const started = attempt(`start ${path}`, run);
    nitroApp.hooks.hook("close", () => attempt(`stop ${path}`, async () => (await started)?.()));
  }

  // Ends open streams and sockets as a production server shuts down. Not on `close`,
  // which development also runs whenever Vite restarts.
  nitroApp.hooks.hook("shutdown", () => shutdown.abort());
});

function attempt<Result>(
  description: string,
  run: () => Result | Promise<Result>,
): Promise<Result | void> {
  return (async () => run())().catch((error) => console.error(`Unable to ${description}:`, error));
}
