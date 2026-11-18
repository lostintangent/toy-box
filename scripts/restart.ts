// Restarts the dev server on 3100. Agents run as children of that server, so the restart detaches
// from its caller, waits for the caller's turn to end, and stops the server the way Ctrl-C would,
// by signaling its whole process group.

import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { $ } from "bun";

const PORT = 3100;
const GRACE_SECONDS = 30;
const LOG = `/tmp/toy-box-${PORT}.log`;
// An agent's shell adds its own variables, which the new server would pass to every agent it spawns.
const CALLER_VARIABLES = /^(COPILOT_|CLAUDE|CODEX_|GIT_|GCM_|SSH_ASKPASS|npm_|TOY_BOX_RESTART)/;

if (!process.env.TOY_BOX_RESTART) {
  const env = { ...process.env, TOY_BOX_RESTART: "1" };
  spawn(process.execPath, [import.meta.path], { detached: true, stdio: "ignore", env }).unref();
  console.log(
    `Restarting ${PORT} in ${GRACE_SECONDS}s, so end your turn. The new server logs to ${LOG}.`,
  );
  process.exit(0);
}

const listener = async () =>
  (await $`lsof -t -nP -iTCP:${PORT} -sTCP:LISTEN`.nothrow().text()).trim().split("\n")[0];

await Bun.sleep(GRACE_SECONDS * 1000);
const pid = await listener();
if (pid) {
  const group = Number((await $`ps -o pgid= -p ${pid}`.text()).trim());
  process.kill(-group, "SIGTERM");
  for (let second = 0; (await listener()) && second < 30; second++) await Bun.sleep(1000);
  if (await listener()) {
    process.kill(-group, "SIGKILL");
    await Bun.sleep(1000);
  }
}

const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !CALLER_VARIABLES.test(name)),
);
const log = openSync(LOG, "w");
spawn("bun", ["dev"], { cwd: `${import.meta.dir}/..`, env, stdio: ["ignore", log, log] }).unref();
