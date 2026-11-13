// The server resource clients read: this server's identity, name, accent color and links, the
// release it runs and the one installed on disk, and updating and restarting into a newer one.

import { homedir } from "node:os";
import { delimiter, dirname } from "node:path";
import { useNitroHooks } from "nitro/app";
import { getProcessValue } from "@/shared/server/processState";
import { RefusalError } from "@/shared/server/http";
import { bin, name, version } from "../../../../package.json";
import { computerName } from "./state/environment";
import { getSettings } from "./state/settings";

// The command package managers put on PATH, and the file in this package it runs.
const [[commandName, binaryFile]] = Object.entries(bin);

// Global installs, matched by where each package manager keeps them rather than its
// home folder's name, so `bun dev`, npx and bunx runs, and downloaded binaries match
// none. Vite+ comes first because its packages also sit in `lib/node_modules`.
const packageManagers = [
  { layouts: ["/.vite-plus/packages/"], command: "vp install -g" },
  { layouts: ["/install/global/node_modules/"], command: "bun add -g --no-cache" },
  { layouts: ["/pnpm/global/", "/pnpm/store/"], command: "pnpm add -g" },
  { layouts: ["/lib/node_modules/"], command: "npm install -g" },
];

/** The command that updates the Toy Box binary at `execPath`, or nothing when no package manager owns it. */
export function updateCommand(execPath: string): string | undefined {
  if (!execPath.endsWith(`/node_modules/${name}/${binaryFile}`)) return;

  const manager = packageManagers.find(({ layouts }) =>
    layouts.some((layout) => execPath.includes(layout)),
  );
  return manager && `${manager.command} ${name}@latest`;
}

// The installation on disk, read once and again after each update, since running its command
// takes about a third of a second.
let installation: ReturnType<typeof readInstalled> | undefined;

/** This server as its clients and linked servers see it. */
export async function getServer() {
  const { serverId, serverName, accentColor, serverLinks } = await getSettings();
  return {
    id: serverId,
    name: serverName || computerName,
    accentColor,
    version,
    installedVersion: (await (installation ??= readInstalled()))?.version ?? null,
    links: serverLinks,
  };
}

// Only routes and server functions update, and they share this module.
let updating: Promise<void> | undefined;

/** Installs the newest release with the package manager that owns this install. Concurrent calls share one run. */
export async function updateServer() {
  updating ??= install().finally(() => {
    updating = undefined;
  });
  await updating;
  return getServer();
}

async function install() {
  const installed = await (installation ??= readInstalled());
  if (!installed) throw new RefusalError(`No package manager owns this ${commandName} install.`);

  // The manager beside the command is the one that installed it. Managers cache `latest` for
  // minutes, so npm and Vite+ prefer online, and bun, which ignores that, skips its cache.
  const path = `${dirname(installed.command)}${delimiter}${process.env.PATH}`;
  const result =
    await Bun.$`PATH=${path} npm_config_prefer_online=true ${installed.update.split(" ")} < /dev/null`
      .cwd(homedir())
      .nothrow()
      .quiet();
  if (result.exitCode === 0) {
    installation = readInstalled();
    return;
  }

  // Managers surround the cause with progress, retries and stack traces, on either stream.
  const output = Bun.stripANSI([result.stderr, result.stdout].join("\n")).trim();
  const errors = output.split("\n").filter((line) => /\berr/i.test(line) && !/warn/i.test(line));
  throw new RefusalError((errors.length ? errors : [output]).join("\n"));
}

/** Set by the launcher, which replaces this process with `command` using its own flags. */
type Relaunch = (command: string) => never;

/** Relaunches even when a feature's cleanup hangs. */
const RESTART_DEADLINE_MS = 15_000;

/** Shuts down as Ctrl+C does, then becomes the installed release, which it answers with. Refuses
 *  when it couldn't come back. */
export async function restartServer() {
  const relaunch = getProcessValue<Relaunch | undefined>("relaunch", () => undefined);
  if (!relaunch)
    throw new RefusalError(`Only a server started with \`${commandName}\` can restart.`);

  const installed = await (installation ??= readInstalled());
  if (!installed) throw new RefusalError(`No package manager owns this ${commandName} install.`);

  // Every feature registered its close hook at boot, so this one relaunches after their cleanup.
  const restart = () => relaunch(installed.command);
  useNitroHooks().hook("close", restart);
  setTimeout(restart, RESTART_DEADLINE_MS);
  process.kill(process.pid, "SIGTERM");
  return installed.version;
}

// Run the command on PATH rather than `process.execPath`, which pnpm and Vite+ move
// with each release, so it would keep reporting and restarting the running version.
async function readInstalled() {
  const update = updateCommand(process.execPath);
  if (!update) return;

  const command = Bun.which(commandName);
  if (!command) return;

  const result = await Bun.$`${command} --version`.nothrow().quiet();
  if (result.exitCode === 0) return { command, version: result.text().trim(), update };
}
