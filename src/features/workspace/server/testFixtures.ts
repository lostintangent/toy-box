import { onTestFinished, spyOn } from "bun:test";
import * as peers from "./peers";

/** Makes the given base URLs' origins this test's peers, in order, without asking Tailscale or
 *  reaching them. With none, the test has no peers. */
export function setPeers(...urls: string[]) {
  const listPeers = spyOn(peers, "listPeers").mockResolvedValue(
    urls.map((url) => new URL(url).origin),
  );
  onTestFinished(() => listPeers.mockRestore());
}

export type Handler = (request: Request) => Response | Promise<Response>;

/** A fake peer for one test, which answers every request with the handler. */
export function servePeer(fetch: Handler): URL {
  const server = Bun.serve({ port: 0, fetch });
  onTestFinished(() => server.stop(true));
  return server.url;
}

/** Answers as a Toy Box server named `name` running 0.4.0, with no installed release, and hands
 *  every request other than that read to `handle`. */
export function toyBoxServer(
  name: string,
  handle: Handler = () => new Response("Not found", { status: 404 }),
): Handler {
  const id = crypto.randomUUID();
  return (request) =>
    request.method === "GET" && new URL(request.url).pathname === "/api/v1/server"
      ? Response.json({ id, name, version: "0.4.0", installedVersion: null, peers: [] })
      : handle(request);
}
