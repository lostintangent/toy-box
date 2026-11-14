// The server resource clients read: this server's identity, name, accent color and peers, the
// release it runs and the one installed on disk, and updating and restarting into a newer one, on
// this server alone or across it and its peers.

import { homedir } from "node:os";
import { delimiter, dirname } from "node:path";
import { useNitroHooks } from "nitro/app";
import { getProcessValue } from "@/shared/server/processState";
import { RefusalError } from "@/shared/server/http";
import { bin, name, version } from "../../../../package.json";
import { isRestartPending } from "../model/server";
import { broadcast } from "./events";
import { getPeerServers, listPeers, post, readServer } from "./peers";
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
// takes about a third of a second, and the update in flight, which concurrent calls share.
// Workspace's startup loads this module in another bundle than its routes, so both live in the process.
const store = getProcessValue("workspace.installation", () => ({
  installation: undefined as ReturnType<typeof readInstalled> | undefined,
  updating: undefined as Promise<void> | undefined,
}));

/** This server as its clients and peers see it. */
export async function getServer() {
  const [{ serverId, serverName, accentColor }, installedVersion, peers] = await Promise.all([
    getSettings(),
    getInstalledVersion(),
    listPeers(),
  ]);
  return {
    id: serverId,
    name: serverName || computerName,
    accentColor,
    version,
    installedVersion,
    peers,
  };
}

/** The release a restart would run, or null when no package manager owns this install. */
export async function getInstalledVersion() {
  return (await (store.installation ??= readInstalled()))?.version ?? null;
}

/** Installs the newest release with the package manager that owns this install. Concurrent calls share one run. */
export async function updateServer() {
  store.updating ??= install().finally(() => {
    store.updating = undefined;
  });
  await store.updating;
  return getServer();
}

async function install() {
  const installed = await (store.installation ??= readInstalled());
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
    store.installation = readInstalled();
    const installedVersion = await getInstalledVersion();
    if (installedVersion && installedVersion !== installed.version) {
      broadcast({ type: "server.updated", installedVersion });
    }
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

  // An install in flight finishes first, so the relaunch never runs a half-written release.
  await store.updating?.catch(() => {});
  const installed = await (store.installation ??= readInstalled());
  if (!installed) throw new RefusalError(`No package manager owns this ${commandName} install.`);

  // Every feature registered its close hook at boot, so this one relaunches after their cleanup.
  const restart = () => relaunch(installed.command);
  useNitroHooks().hook("close", restart);
  setTimeout(restart, RESTART_DEADLINE_MS);
  process.kill(process.pid, "SIGTERM");
  return installed.version;
}

/** Installs the newest release on this server, when a package manager owns its install, and on
 *  every peer server, whose own update refuses when none does. Peers fail silently, since each one's
 *  auto-update catches up. Only the web calls this, and each server's own update stays local, so no
 *  request bounces between servers. */
export async function updateServers() {
  const [update] = await Promise.allSettled([
    getInstalledVersion().then((installed) => (installed ? updateServer() : undefined)),
    getPeerServers().then((servers) =>
      Promise.allSettled(
        servers.map(({ origin }) => post(`${origin}/api/v1/server/update`, {}, 120_000)),
      ),
    ),
  ]);
  if (update.status === "rejected") throw update.reason;
}

/** Restarts the servers with a pending restart: each such peer, waiting until it runs its new
 *  release so a refresh finds it back, and then this one. With none pending, restarts this one onto
 *  the release it runs. Answers with the release this server runs once it returns. */
export async function restartServers() {
  const deadline = Date.now() + 30_000;
  const peers = (await getPeerServers()).filter(isRestartPending);
  await Promise.allSettled(
    peers.map(async ({ origin, installedVersion }) => {
      await post(`${origin}/api/v1/server/restart`, {}, deadline - Date.now());
      while ((await readServer(origin).catch(() => undefined))?.version !== installedVersion) {
        if (Date.now() > deadline) return;
        await Bun.sleep(1_000);
      }
    }),
  );
  if (peers.length && !isRestartPending({ version, installedVersion: await getInstalledVersion() }))
    return version;
  return restartServer();
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
