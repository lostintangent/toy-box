import { expect, test } from "bun:test";
import { listPeerChannels } from "./peers";
import { servePeer, setPeers, toyBoxServer } from "@workspace/server/testFixtures";
import { channelCatalog } from "./testFixtures";

test("lists every answering peer server's channels under its name", async () => {
  const studio = servePeer(
    toyBoxServer(
      "Studio",
      channelCatalog([
        { id: "apple", name: "Apple", purpose: "Ship the apps." },
        { id: "web", name: "Web", purpose: null },
      ]),
    ),
  );
  // A peer that lists its channels but doesn't name itself isn't a Toy Box server.
  const nameless = servePeer((request) =>
    new URL(request.url).pathname === "/api/v1/channels"
      ? Response.json({ channels: [{ id: "old", name: "Old" }] })
      : new Response("Not found", { status: 404 }),
  );
  setPeers(studio.href, nameless.href, "http://127.0.0.1:1");

  expect(await listPeerChannels()).toEqual([
    { channelId: "apple", name: "Apple", purpose: "Ship the apps.", server: "Studio" },
    { channelId: "web", name: "Web", server: "Studio" },
  ]);
});
