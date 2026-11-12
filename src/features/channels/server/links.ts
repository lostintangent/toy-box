import { z } from "zod";
import { conciseChannelMessageSchema, durableIdSchema } from "@channels/model";
import { RefusalError } from "@/shared/server/http";
import { isLoopbackHostname } from "@/shared/utils";
import { getServer } from "@workspace/server/installation";
import { updateSettings } from "@workspace/server/state";
import { getSettings } from "@workspace/server/state/settings";

// A link is one of the owner's other Toy Box servers, whose channel leads can message this
// server's leads. It's the server's origin, which the owner adds once this server reaches it.
// Linking and unlinking ask the other server to do the same, so both ends agree. Links live in
// the workspace settings as `serverLinks`.

/** A channel on a linked server, which a lead can message but not open. `server` is that server's
 *  name and `link` its origin, since two servers can share a name. */
type LinkedChannel = {
  channelId: string;
  name: string;
  purpose?: string;
  server: string;
  link: string;
};

/** The owner links or unlinks a server by its address, however it's typed. */
export const linkInputSchema = z.object({ address: z.string() }).strict();

/** A linked server's lead delivers its message here, naming its channel on its own server. */
export const linkedLeadMessageInputSchema = z
  .object({
    channelId: durableIdSchema,
    from: durableIdSchema,
    content: conciseChannelMessageSchema,
  })
  .strict();
export type LinkedLeadMessageInput = z.infer<typeof linkedLeadMessageInputSchema>;

// The servers this one is linking, which a server linking back while it's asked joins.
const linking = new Set<string>();

/** Links a server once it answers and links this one back, so a typo, a sleeping machine or this
 *  server itself is caught when it's added. `self` is this server's link as the request reached
 *  it, and a request on loopback has none, so only this end links. Linking a server that's linked,
 *  or that this server is linking, changes nothing, even while it sleeps. */
export async function linkServer(address: string, self?: string): Promise<void> {
  const link = normalizeLink(address);
  if ((await getSettings()).serverLinks.includes(link) || linking.has(link)) return;
  const [peer, server] = await Promise.all([
    readServer(link).catch((error: unknown) => {
      throw new RefusalError(
        error instanceof StatusError && error.status === 404
          ? `Update Toy Box on ${link}, then link it again.`
          : `This server can't reach ${link} (${describe(error)}).`,
      );
    }),
    getServer(),
  ]);
  if (peer.id === server.id) throw new RefusalError("That's this server.");

  linking.add(link);
  try {
    if (self)
      await post(`${link}/api/v1/server/links`, { address: self }, 10_000).catch((error) => {
        throw new RefusalError(`${link} didn't link back: ${describe(error)}.`);
      });
    await updateSettings(({ serverLinks }) => ({ serverLinks: [...serverLinks, link] }));
  } finally {
    linking.delete(link);
  }
}

/** Unlinks a server, and asks it to unlink this one when the request names this server's link.
 *  A server that doesn't answer stays linked to this one until the owner unlinks it there.
 *  Unlinking a server that isn't linked changes nothing. */
export async function unlinkServer(address: string, self?: string): Promise<void> {
  const link = normalizeLink(address);
  if (!(await getSettings()).serverLinks.includes(link)) return;
  await updateSettings(({ serverLinks }) => ({
    serverLinks: serverLinks.filter((linked) => linked !== link),
  }));
  if (!self) return;
  await fetch(`${link}/api/v1/server/links?address=${encodeURIComponent(self)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(3_000),
  }).catch(() => {});
}

/** This server's link as a request reached it, honoring a proxy's protocol. A request on loopback
 *  has none, since no other server reaches this one there. */
export function requestLink(request: Request): string | undefined {
  const url = new URL(request.url);
  if (isLoopbackHostname(url.hostname)) return;
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return normalizeLink(`${forwarded || url.protocol.slice(0, -1)}://${url.host}`);
}

/** A link is an http or https origin, where a bare host means https, so however the owner types
 *  a server, it's one link. */
function normalizeLink(input: string): string {
  const typed = input.trim();
  const url = URL.parse(typed.includes("://") ? typed : `https://${typed}`);
  if (url?.protocol !== "http:" && url?.protocol !== "https:")
    throw new RefusalError("Enter a host like mac-mini.tail1234.ts.net, or an http:// address.");
  return url.origin;
}

/** Every linked server's channels, under the name that server gives itself. A server that doesn't
 *  answer within the bound is unavailable, so one sleeping machine never hides the others. */
export async function listLinkedChannels(): Promise<{
  channels: LinkedChannel[];
  unavailable: { link: string; error: string }[];
}> {
  const links = (await getSettings()).serverLinks;
  const answers = await Promise.allSettled(links.map(readLinkedChannels));
  return {
    channels: answers.flatMap((answer) => (answer.status === "fulfilled" ? answer.value : [])),
    unavailable: links.flatMap((link, index) => {
      const answer = answers[index]!;
      return answer.status === "rejected" ? [{ link, error: describe(answer.reason) }] : [];
    }),
  };
}

/** Delivers a lead's message to a channel on a linked server, once. The peer answers when its
 *  lead accepts the message, which can wait on a cold start, so the bound is generous and a
 *  message that may have landed is never resent. A failure names the server and its reason. */
export async function messageLinkedChannelLead(
  from: string,
  { channelId, content }: { channelId: string; content: string },
): Promise<void> {
  const { channels, unavailable } = await listLinkedChannels();
  const target = channels.find((channel) => channel.channelId === channelId);
  if (!target) {
    const servers = unavailable.map(({ link, error }) => `${link} (${error})`).join(", ");
    throw new Error(servers ? `Channel not found. Unavailable: ${servers}.` : "Channel not found.");
  }
  const url = `${target.link}/api/v1/channels/${encodeURIComponent(channelId)}/lead-messages`;
  await post(url, { from, content }, 60_000).catch((error) => {
    throw new Error(`${target.server}: ${describe(error)}.`);
  });
}

const serverSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const catalogSchema = z.object({
  channels: z.array(z.object({ id: z.string(), name: z.string(), purpose: z.string().nullish() })),
});
const errorSchema = z.object({ error: z.string().min(1) });

async function readLinkedChannels(link: string): Promise<LinkedChannel[]> {
  const [server, { channels }] = await Promise.all([
    readServer(link),
    read(`${link}/api/v1/channels`, catalogSchema),
  ]);
  return channels.map(({ id, name, purpose }) => ({
    channelId: id,
    name,
    ...(purpose ? { purpose } : {}),
    server: server.name,
    link,
  }));
}

function readServer(link: string) {
  return read(`${link}/api/v1/server`, serverSchema);
}

/** A linked server answered a read with a failing status. */
class StatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function read<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new StatusError(response.status);
  const answer = schema.safeParse(await response.json().catch(() => undefined));
  if (!answer.success) throw new Error("Not a Toy Box server");
  return answer.data;
}

/** Posts to a linked server, failing with its refusal or status when it doesn't accept. */
async function post(url: string, body: unknown, bound: number): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(bound),
  });
  if (response.ok) return;
  const answer = errorSchema.safeParse(await response.json().catch(() => undefined));
  throw new Error(answer.data?.error ?? `HTTP ${response.status}`);
}

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\.$/, "");
}
