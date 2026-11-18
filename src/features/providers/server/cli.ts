import { homedir } from "node:os";
import { delimiter, dirname } from "node:path";

// Provider IDs name their CLIs, which all support --version and update.
export function isInstalled(providerId: string): boolean {
  return !!Bun.which(providerId);
}

export async function readVersion(providerId: string): Promise<string> {
  // Copilot's launcher would name a newer cached build, but the server runs it without auto-update.
  const output = await runCommand(providerId, "--version", { COPILOT_AUTO_UPDATE: "false" });
  const version = output.match(/\d+\.\d+\.\d+(?:-[\w-]+(?:\.[\w-]+)*)?/)?.[0];
  if (!version) throw new Error(`Unable to read ${providerId} version.`);
  return version;
}

export async function updateProvider(providerId: string) {
  const before = await readVersion(providerId);
  await runCommand(providerId, "update");
  const version = await readVersion(providerId);
  return { version, updated: version !== before };
}

function runCommand(
  providerId: string,
  argument: string,
  env?: Record<string, string>,
): Promise<string> {
  const executable = Bun.which(providerId);
  if (!executable) throw new Error(`Could not find ${providerId} on PATH.`);
  // Updaters must find their own package manager before the dev server's local shims.
  const cliPath = `${dirname(executable)}${delimiter}${process.env.PATH}`;
  return Bun.$`PATH=${cliPath} ${executable} ${argument} < /dev/null`
    .env({ ...process.env, ...env })
    .cwd(homedir())
    .text();
}
