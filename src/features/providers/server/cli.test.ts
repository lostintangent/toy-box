import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { readVersion, updateProvider } from "./cli";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "toy box provider cli-"));
});

afterEach(() => rm(directory, { recursive: true, force: true }));

test.each([
  ["GitHub Copilot CLI 1.0.86.\nRun 'copilot update' to check for updates.", "1.0.86"],
  ["GitHub Copilot CLI 1.0.89-0.\nRun 'copilot update' to check for updates.", "1.0.89-0"],
  ["codex-cli 0.154.0", "0.154.0"],
  ["2.1.278 (Claude Code)", "2.1.278"],
])("reads the version from %s", async (output, version) => {
  expect(await readVersion(await createCli(output))).toBe(version);
});

test("compares installed versions rather than update command output", async () => {
  const cli = await createCli("1.0.0", 'await Bun.write(versionFile, "1.1.0");');
  expect(await updateProvider(cli)).toEqual({ version: "1.1.0", updated: true });
  expect(await updateProvider(cli)).toEqual({ version: "1.1.0", updated: false });
});

test("reports command failures even when the installed version remains readable", async () => {
  const cli = await createCli("1.0.0", 'console.error("Update failed"); process.exit(1);');
  await expect(updateProvider(cli)).rejects.toThrow();
});

test("requires a readable version before attempting an update", async () => {
  const cli = await createCli("Unknown version", 'await Bun.write(versionFile, "1.0.0");');
  await expect(updateProvider(cli)).rejects.toThrow("Unable to read");
  expect(await Bun.file(join(directory, "version")).text()).toBe("Unknown version");
});

test("uses the CLI's updater before project-local development shims", async () => {
  const projectBin = join(directory, "project-bin");
  await mkdir(projectBin);
  for (const [bin, exitCode] of [
    [directory, 0],
    [projectBin, 1],
  ] as const) {
    const updater = join(bin, "provider-updater");
    await Bun.write(updater, `#!/bin/sh\nexit ${exitCode}\n`);
    await chmod(updater, 0o755);
  }
  const cli = await createCli(
    "1.0.0",
    `
    if (await Bun.spawn(["provider-updater"]).exited) process.exit(1);
    await Bun.write(versionFile, "1.1.0");
  `,
  );
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = `${projectBin}${delimiter}${previousPath}`;
    expect(await updateProvider(cli)).toEqual({ version: "1.1.0", updated: true });
  } finally {
    process.env.PATH = previousPath;
  }
});

async function createCli(output: string, update = ""): Promise<string> {
  const cli = join(directory, "provider");
  await Bun.write(join(directory, "version"), output);
  await Bun.write(
    cli,
    `#!${process.execPath}
const versionFile = import.meta.dir + "/version";
if (process.argv[2] === "--version") {
  console.log(await Bun.file(versionFile).text());
} else if (process.argv[2] === "update") {
  ${update}
  console.log("Update ran successfully");
} else process.exit(1);
`,
  );
  await chmod(cli, 0o755);
  return cli;
}
