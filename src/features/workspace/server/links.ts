import { z } from "zod";
import { NotFoundError, RefusalError } from "@/shared/server/http";
import { isLoopbackHostname } from "@/shared/utils";
import { getServer } from "./installation";
import { updateSettings } from "./state";
import { getSettings } from "./state/settings";

// A link is one of the owner's other Toy Box servers, which features reach with the reads and
// posts at the end of this module, as Channels' leads do to message theirs. It's the server's
// origin, which the owner adds once this server reaches it. Linking and unlinking ask the other
// server to do the same, so both ends agree. Links live in the workspace settings as `serverLinks`.

/** The owner names a server by its address, however it's typed. */
export const linkInputSchema = z.object({ address: z.string() }).strict();

// The servers this one is linking, which a server linking back while it's asked joins.
const linking = new Set<string>();

/** Links a server once it answers and links this one back, and refuses anything else, whether a
 *  typo, a sleeping machine or this server itself, the same way, since each has the same fix.
 *  `self` is this server's link as the request reached it, and a request on loopback has none, so
 *  only this end links. Linking a server that's linked, or that this server is linking, changes
 *  nothing, even while it sleeps. */
export async function linkServer(address: string, self?: string): Promise<void> {
  const link = normalizeLink(address);
  const refuse = (): never => {
    throw new RefusalError(
      `Couldn't link ${link ?? address.trim()}. Check the address and that Toy Box is running there.`,
    );
  };
  if (!link) return refuse();
  if ((await getSettings()).serverLinks.includes(link) || linking.has(link)) return;
  const [peer, server] = await Promise.all([readServer(link).catch(refuse), getServer()]);
  if (peer.id === server.id) refuse();

  linking.add(link);
  try {
    if (self) await post(`${link}/api/v1/server/links`, { address: self }, 10_000).catch(refuse);
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
  if (!link || !(await getSettings()).serverLinks.includes(link)) return;
  await updateSettings(({ serverLinks }) => ({
    serverLinks: serverLinks.filter((linked) => linked !== link),
  }));
  if (!self) return;
  await fetch(`${link}/api/v1/server/links?address=${encodeURIComponent(self)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(3_000),
  }).catch(() => {});
}

/** A linked server's name and release, as it answers this server. Only a linked server is read,
 *  so no one can use this server to reach another address. */
export async function getLinkedServer(link: string) {
  if (!(await getSettings()).serverLinks.includes(link)) throw new NotFoundError("Linked server");
  return readServer(link);
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
 *  a server, it's one link. Anything else isn't a link. */
function normalizeLink(input: string): string | undefined {
  const typed = input.trim();
  const url = URL.parse(typed.includes("://") ? typed : `https://${typed}`);
  if (url?.protocol === "http:" || url?.protocol === "https:") return url.origin;
}

const serverSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
});

/** A linked server's id, the name it gives itself and the release it runs. */
export function readServer(link: string) {
  return read(`${link}/api/v1/server`, serverSchema);
}

/** Reads a linked server's resource within the bound, failing unless it answers as a Toy Box
 *  server does. */
export async function read<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  return schema.parse(await response.json());
}

/** Posts to a linked server within the bound, failing unless it accepts. */
export async function post(url: string, body: unknown, bound: number): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(bound),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
