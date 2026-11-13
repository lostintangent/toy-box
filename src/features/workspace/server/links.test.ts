import { expect, test } from "bun:test";
import { openTestDatabase } from "@/server/testFixtures";
import { getLinkedServer } from "./links";
import { linkServers, serveLinkedServer, toyBoxServer } from "./testFixtures";

test("reads a linked server's name and release, and refuses any other address", async () => {
  await openTestDatabase();
  const studio = serveLinkedServer(toyBoxServer("Studio"));
  const stranger = serveLinkedServer(toyBoxServer("Stranger"));
  await linkServers(studio.href);

  expect(await getLinkedServer(studio.origin)).toMatchObject({ name: "Studio", version: "0.4.0" });
  await expect(getLinkedServer(stranger.origin)).rejects.toThrow("Linked server not found.");
});
