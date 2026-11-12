import { expect, test } from "bun:test";
import { listLinkedChannels } from "./links";
import { openTestDatabase } from "@/server/testFixtures";
import { linkServers, serveLinkedServer, toyBoxServer } from "./testFixtures";

test("lists every answering server's channels under its name and names the rest unavailable", async () => {
  await openTestDatabase();
  const studio = serveLinkedServer(
    toyBoxServer("Studio", [
      { id: "apple", name: "Apple", purpose: "Ship the apps." },
      { id: "web", name: "Web", purpose: null },
    ]),
  );
  // An older server lists its channels but has no server resource to name it.
  const older = serveLinkedServer((request) =>
    new URL(request.url).pathname === "/api/v1/channels"
      ? Response.json({ channels: [{ id: "old", name: "Old" }] })
      : new Response("Not found", { status: 404 }),
  );
  const page = serveLinkedServer(() => new Response("<html></html>"));
  await linkServers(studio.href, older.href, page.href, "http://127.0.0.1:1");

  const { channels, unavailable } = await listLinkedChannels();
  expect(channels).toEqual([
    {
      channelId: "apple",
      name: "Apple",
      purpose: "Ship the apps.",
      server: "Studio",
      link: studio.origin,
    },
    { channelId: "web", name: "Web", server: "Studio", link: studio.origin },
  ]);
  expect(unavailable).toEqual([
    { link: older.origin, error: "HTTP 404" },
    { link: page.origin, error: "Not a Toy Box server" },
    { link: "http://127.0.0.1:1", error: expect.stringContaining("ECONNREFUSED") },
  ]);
});
