import { expect, test } from "bun:test";
import { getPeerServers } from "./peers";
import { servePeer, setPeers, toyBoxServer } from "./testFixtures";

test("lists only the peers that answer as Toy Box servers, with their names and releases", async () => {
  const studio = servePeer(toyBoxServer("Studio"));
  const other = servePeer(() => new Response("Not found", { status: 404 }));
  setPeers(studio.href, other.href, "http://127.0.0.1:1");

  expect(await getPeerServers()).toEqual([
    { origin: studio.origin, name: "Studio", version: "0.4.0", installedVersion: null },
  ]);
});
