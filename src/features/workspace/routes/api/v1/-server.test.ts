import { expect, test } from "bun:test";
import { invokeRoute, openTestDatabase } from "@/server/testFixtures";
import { getServer } from "@workspace/server/installation";
import startWorkspace from "@workspace/server/startup";
import { computerName } from "@workspace/server/state/environment";
import { linkServers, serveLinkedServer, toyBoxServer } from "@workspace/server/testFixtures";
import { Route } from "./server.index";
import { Route as ServerLinksRoute } from "./server.links";

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function patch(body: unknown) {
  return invokeRoute(Route, new Request("http://toy-box.test/api/v1/server", json("PATCH", body)));
}

test("an update changes only the details it names, by each one's settings rule", async () => {
  await openTestDatabase();

  const named = await (await patch({ name: "Studio" })).json();
  expect(named).toMatchObject({ name: "Studio", accentColor: "#facc15" });

  const colored = await (await patch({ accentColor: "#2f6f8f" })).json();
  expect(colored).toMatchObject({ id: named.id, name: "Studio", accentColor: "#2f6f8f" });

  const unnamed = await (await patch({ name: "" })).json();
  expect(unnamed).toMatchObject({ name: computerName, accentColor: "#2f6f8f" });

  expect((await patch({ accentColor: "teal" })).status).toBe(400);
});

// Route requests reach this server as http://toy-box.test, which a linked server can link back to.
function serverLinks(init?: RequestInit, query = "", origin = "http://toy-box.test") {
  return invokeRoute(ServerLinksRoute, new Request(`${origin}/api/v1/server/links${query}`, init));
}
const link = (address: string, origin?: string) =>
  serverLinks(json("POST", { address }), "", origin);
const unlink = (address: string, origin?: string) =>
  serverLinks({ method: "DELETE" }, `?address=${encodeURIComponent(address)}`, origin);
const links = async (answer: Response | Promise<Response>) => (await (await answer).json()).links;

/** A linked server that links and unlinks this one back through this server's route, as a real
 *  one would, and records what it was asked. */
function serveLinkingServer(name: string) {
  const asked: string[] = [];
  const server = serveLinkedServer(
    toyBoxServer(name, async (request) => {
      const url = new URL(request.url);
      if (url.pathname !== "/api/v1/server/links") return new Response(null, { status: 404 });
      if (request.method === "POST") {
        const { address } = await request.json();
        asked.push(`link ${address}`);
        return link(url.origin, address);
      }
      const address = url.searchParams.get("address")!;
      asked.push(`unlink ${address}`);
      return unlink(url.origin, address);
    }),
  );
  return Object.assign(server, { asked });
}

test("linking and unlinking change both ends once however an address is typed, and answer the server", async () => {
  await openTestDatabase();
  const studio = serveLinkingServer("Studio");
  const laptop = serveLinkingServer("Laptop");
  // Linked last, the laptop sorts first, so only link order puts it second.
  const laptopLink = `http://127.0.0.1:${laptop.port}`;

  const linked = await link(` ${studio.href} `);
  expect(await linked.json()).toEqual({ ...(await getServer()), links: [studio.origin] });
  expect(await links(link(`${laptopLink}//?tab=1#top`))).toEqual([studio.origin, laptopLink]);
  expect(await links(link(studio.origin))).toEqual([studio.origin, laptopLink]);
  expect(await links(unlink(studio.href))).toEqual([laptopLink]);
  expect(await links(unlink(studio.href))).toEqual([laptopLink]);
  expect(studio.asked).toEqual(["link http://toy-box.test", "unlink http://toy-box.test"]);
  expect(laptop.asked).toEqual(["link http://toy-box.test"]);

  // A server that's already linked answers without being reached, even while it sleeps.
  await linkServers(laptopLink, "http://127.0.0.1:1");
  expect(await links(link("http://127.0.0.1:1/"))).toEqual([laptopLink, "http://127.0.0.1:1"]);
  // One that doesn't answer an unlink stays linked to this one until it's unlinked there.
  expect(await links(unlink("http://127.0.0.1:1"))).toEqual([laptopLink]);
});

test("a request that reaches this server on loopback links and unlinks only this end", async () => {
  await openTestDatabase();
  const studio = serveLinkingServer("Studio");

  for (const origin of ["http://localhost:3100", "http://127.0.0.1:3100", "http://[::1]:3100"]) {
    expect(await links(link(studio.href, origin))).toEqual([studio.origin]);
    expect(await links(unlink(studio.href, origin))).toEqual([]);
  }
  expect(studio.asked).toEqual([]);
});

test("a server that links this one back over a proxy is asked at the proxy's address", async () => {
  await openTestDatabase();
  const studio = serveLinkingServer("Studio");

  const proxied = new Request("http://mac-mini.ts.net/api/v1/server/links", {
    ...json("POST", { address: studio.href }),
    headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https, http" },
  });
  expect((await invokeRoute(ServerLinksRoute, proxied)).status).toBe(200);
  expect(studio.asked).toEqual(["link https://mac-mini.ts.net"]);
});

test("an address that isn't another reachable Toy Box server that links back is refused, and nothing changes", async () => {
  await openTestDatabase();
  await startWorkspace();
  const refusal = (address: string) =>
    `Couldn't link ${address}. Check the address and that Toy Box is running there.`;
  const missing = serveLinkedServer(() => new Response("Not found", { status: 404 }));
  const itself = serveLinkedServer(async () => Response.json(await getServer()));
  let refusals = 0;
  const refusing = serveLinkedServer(
    toyBoxServer("Studio", () => {
      refusals += 1;
      return Response.json({ error: refusal("http://toy-box.test") }, { status: 422 });
    }),
  );

  for (const [address, error] of [
    ["ftp://studio", refusal("ftp://studio")],
    // A bare host means https, which this plain-HTTP server can't speak.
    [missing.host, refusal(`https://${missing.host}`)],
    [missing.href, refusal(missing.origin)],
    [itself.href, refusal(itself.origin)],
    [refusing.href, refusal(refusing.origin)],
    // A refused link isn't left linking, so trying again asks again.
    [refusing.href, refusal(refusing.origin)],
  ]) {
    const refused = await link(address);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error });
  }
  expect(refusals).toBe(2);
  expect((await serverLinks({ method: "DELETE" })).status).toBe(400);
  expect((await getServer()).links).toEqual([]);
});
