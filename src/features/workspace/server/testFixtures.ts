import { onTestFinished } from "bun:test";
import { updateSettings } from "./state";

/** Links the test's state database to the given base URLs, in order, without reaching them. */
export async function linkServers(...urls: string[]) {
  await updateSettings({ serverLinks: urls.map((url) => new URL(url).origin) });
}

export type Handler = (request: Request) => Response | Promise<Response>;

/** A fake linked server for one test, which answers every request with the handler. */
export function serveLinkedServer(fetch: Handler): URL {
  const server = Bun.serve({ port: 0, fetch });
  onTestFinished(() => server.stop(true));
  return server.url;
}

/** Answers as a Toy Box server named `name` running 0.4.0, and hands every request other than
 *  that read to `handle`. */
export function toyBoxServer(
  name: string,
  handle: Handler = () => new Response("Not found", { status: 404 }),
): Handler {
  const id = crypto.randomUUID();
  return (request) =>
    request.method === "GET" && new URL(request.url).pathname === "/api/v1/server"
      ? Response.json({ id, name, version: "0.4.0", links: [] })
      : handle(request);
}
