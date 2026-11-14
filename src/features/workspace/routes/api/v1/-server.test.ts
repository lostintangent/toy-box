import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { expect, onTestFinished, test } from "bun:test";
import { invokeRoute, openTestDatabase } from "@/server/testFixtures";
import { computerName } from "@workspace/server/state/environment";
import { setPeers } from "@workspace/server/testFixtures";
import { Route } from "./server.index";

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function patch(body: unknown) {
  return invokeRoute(Route, new Request("http://toy-box.test/api/v1/server", json("PATCH", body)));
}

test("an update changes only the details it names, by each one's settings rule", async () => {
  await openTestDatabase();
  setPeers();

  const named = await (await patch({ name: "Studio" })).json();
  expect(named).toMatchObject({ name: "Studio", accentColor: "#facc15" });

  const colored = await (await patch({ accentColor: "#2f6f8f" })).json();
  expect(colored).toMatchObject({ id: named.id, name: "Studio", accentColor: "#2f6f8f" });

  const unnamed = await (await patch({ name: "" })).json();
  expect(unnamed).toMatchObject({ name: computerName, accentColor: "#2f6f8f" });

  expect((await patch({ accentColor: "teal" })).status).toBe(400);
});

/** Puts a `tailscale` on PATH for one test, which answers `status` with the given status only when
 *  told to act as the CLI, as the app's own binary does. */
async function useTailscale(status: unknown) {
  const dir = await mkdtemp(join(tmpdir(), "tailscale-"));
  const cli = join(dir, "tailscale");
  await Bun.write(join(dir, "status.json"), JSON.stringify(status));
  await Bun.write(
    cli,
    `#!/bin/sh\n[ "$TAILSCALE_BE_CLI" = 1 ] && exec cat "${dir}/status.json"\necho "The Tailscale GUI failed to start."\n`,
  );
  await chmod(cli, 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${dir}${delimiter}${path}`;
  onTestFinished(async () => {
    process.env.PATH = path;
    await rm(dir, { recursive: true });
  });
}

test("the server's peers are the owner's other Macs online on its tailnet", async () => {
  await openTestDatabase();
  const peer = (DNSName: string, { OS = "macOS", Online = true, UserID = 7 } = {}) => ({
    DNSName,
    OS,
    Online,
    UserID,
  });
  await useTailscale({
    Self: { UserID: 7 },
    Peer: {
      studio: peer("studio.tail1.ts.net."),
      laptop: peer("laptop.tail1.ts.net."),
      asleep: peer("asleep.tail1.ts.net.", { Online: false }),
      phone: peer("iphone.tail1.ts.net.", { OS: "iOS" }),
      box: peer("box.tail1.ts.net.", { OS: "linux" }),
      friend: peer("friend.tail1.ts.net.", { UserID: 8 }),
    },
  });

  const server = await invokeRoute(Route, new Request("http://toy-box.test/api/v1/server"));
  expect((await server.json()).peers).toEqual([
    "https://laptop.tail1.ts.net",
    "https://studio.tail1.ts.net",
  ]);
});
