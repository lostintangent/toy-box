import { expect, test } from "bun:test";
import { listLinkedChannels } from "./links";
import { openTestDatabase } from "@/server/testFixtures";
import { linkServers, serveLinkedServer, toyBoxServer } from "@workspace/server/testFixtures";
import { channelCatalog } from "./testFixtures";

test("lists every answering server's channels under its name", async () => {
  await openTestDatabase();
  const studio = serveLinkedServer(
    toyBoxServer(
      "Studio",
      channelCatalog([
        { id: "apple", name: "Apple", purpose: "Ship the apps." },
        { id: "web", name: "Web", purpose: null },
      ]),
    ),
  );
  // A server that lists its channels but doesn't name itself isn't a Toy Box server.
  const nameless = serveLinkedServer((request) =>
    new URL(request.url).pathname === "/api/v1/channels"
      ? Response.json({ channels: [{ id: "old", name: "Old" }] })
      : new Response("Not found", { status: 404 }),
  );
  await linkServers(studio.href, nameless.href, "http://127.0.0.1:1");

  expect(await listLinkedChannels()).toEqual([
    { channelId: "apple", name: "Apple", purpose: "Ship the apps.", server: "Studio" },
    { channelId: "web", name: "Web", server: "Studio" },
  ]);
});
