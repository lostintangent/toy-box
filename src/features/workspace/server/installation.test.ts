import { expect, test } from "bun:test";
import { openTestDatabase } from "@/server/testFixtures";
import { version } from "../../../../package.json";
import { getServer, restartServers, updateCommand } from "./installation";
import startWorkspace from "./startup";
import { servePeer, setPeers, toyBoxServer } from "./testFixtures";

const toyBox = "node_modules/@lostintangent/toy-box/toy-box";

// Paths taken from real installs and one-off runs of each package manager.
test.each([
  [`/Users/me/.vite-plus/packages/@lostintangent/toy-box/e46308d8/lib/${toyBox}`, "vp install -g"],
  [`/Users/me/.bun/install/global/${toyBox}`, "bun add -g --no-cache"],
  [`/Users/me/Library/pnpm/global/5/.pnpm/@lostintangent+toy-box@0.3.8/${toyBox}`, "pnpm add -g"],
  [
    `/Users/me/Library/pnpm/store/v11/links/@lostintangent/toy-box/0.3.8/83db/${toyBox}`,
    "pnpm add -g",
  ],
  [`/opt/homebrew/lib/${toyBox}`, "npm install -g"],
])("%s updates with %s", (execPath, command) => {
  expect(updateCommand(execPath)).toBe(`${command} @lostintangent/toy-box@latest`);
});

test.each([
  "/Users/me/.bun/bin/bun",
  "/opt/homebrew/lib/node_modules/bun/bin/bun.exe",
  `/Users/me/Library/Caches/pnpm/dlx/5b40/1a1c/node_modules/.pnpm/@lostintangent+toy-box@0.3.8/${toyBox}`,
  `/Users/me/.bun/install/cache/.bunx-501/@lostintangent/toy-box@latest/${toyBox}`,
  `/Users/me/.npm/_npx/9f2a/${toyBox}`,
  `/Users/me/code/app/${toyBox}`,
  "/Users/me/Downloads/toy-box-darwin-arm64",
])("%s has no package manager", (execPath) => {
  expect(updateCommand(execPath)).toBeUndefined();
});

test("the server makes its id when it first starts and keeps it across restarts", async () => {
  await openTestDatabase();
  setPeers();
  await startWorkspace();
  const { id } = await getServer();

  await startWorkspace();
  expect(id).not.toBe("");
  expect((await getServer()).id).toBe(id);
});

test("restarts exactly the servers with a pending restart", async () => {
  const restarted: string[] = [];
  const peer = (name: string, running: string, installedVersion: string | null) => {
    let version = running;
    return servePeer((request) => {
      if (request.method !== "POST") return Response.json({ name, version, installedVersion });
      restarted.push(name);
      version = installedVersion ?? version;
      return new Response(null, { status: 202 });
    }).href;
  };
  setPeers(
    peer("Studio", "0.4.0", "0.4.1"),
    peer("Mini", "0.4.1", "0.4.1"),
    peer("Dev", "0.4.1", null),
  );

  // This server runs from source here, so it has nothing pending and keeps its release.
  expect(await restartServers()).toBe(version);
  expect(restarted).toEqual(["Studio"]);
});

test("with nothing pending, restarts this server onto its release", async () => {
  setPeers(servePeer(toyBoxServer("Mini")).href);

  // This server runs from source here, so its own restart refuses, which shows it was asked.
  await expect(restartServers()).rejects.toThrow("can restart");
});
