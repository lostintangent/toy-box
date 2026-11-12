import { onTestFinished } from "bun:test";
import type { CreateChannelInput } from "@channels/model";
import { deleteSessionActivity } from "@sessions/server/state/activity";
import type { Worker } from "@workers/model";
import { openTestDatabase } from "@/server/testFixtures";
import { updateSettings } from "@workspace/server/state";
import { ChannelDatabase } from "./database";
import { releaseChannelEvents } from "./eventLog";

export function channelAgent(
  channelId: string,
  sessionId: string,
  name?: string,
): Extract<Worker, { type: "channel" }> {
  return {
    createdAt: new Date(0).toISOString(),
    type: "channel",
    channelId,
    sessionId,
    ephemeral: false,
    name,
    metadata: { seenThrough: 0 },
  };
}

/** Persist a Channel fixture without starting its provider. */
export function createStoredChannel(database: ChannelDatabase, input: CreateChannelInput) {
  const channelId = crypto.randomUUID();
  return database.createChannel(input, channelAgent(channelId, channelId));
}

/** One stored Channel in a fresh state database that the code under test reads. */
export async function openChannel() {
  const channels = new ChannelDatabase(await openTestDatabase());
  const channel = await createStoredChannel(channels, {
    name: "Studio",
    model: { provider: "copilot", name: "gpt-5.5" },
  });
  onTestFinished(() => {
    releaseChannelEvents(channel.id);
    deleteSessionActivity(channel.id);
  });
  return { channel, channels };
}

/** Links the test's state database to the given base URLs, in order, without reaching them. */
export async function linkServers(...urls: string[]) {
  await updateSettings({ serverLinks: urls.map((url) => new URL(url).origin) });
}

type Handler = (request: Request) => Response | Promise<Response>;

/** A fake linked server for one test, which answers every request with the handler. */
export function serveLinkedServer(fetch: Handler): URL {
  const server = Bun.serve({ port: 0, fetch });
  onTestFinished(() => server.stop(true));
  return server.url;
}

/** Answers as a Toy Box server named `name` with these channels, and hands every request other
 *  than those two reads to `handle`. */
export function toyBoxServer(
  name: string,
  channels: { id: string; name: string; purpose?: string | null }[],
  handle: Handler = () => new Response("Not found", { status: 404 }),
): Handler {
  const id = crypto.randomUUID();
  return (request) => {
    const read = request.method === "GET" && new URL(request.url).pathname;
    if (read === "/api/v1/server") return Response.json({ id, name, links: [] });
    if (read === "/api/v1/channels") return Response.json({ channels, members: [] });
    return handle(request);
  };
}
