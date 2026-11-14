import { z } from "zod";

// A peer is one of the owner's other Macs online on this tailnet, signed in as the same Tailscale
// user, at the MagicDNS origin where `tailscale serve` puts its Toy Box server. Peers are only
// candidates: nothing stores them, each read asks Tailscale, and every reader keeps the ones that
// answer, skipping a Mac that isn't running Toy Box. Features reach peers through the bounded reads
// and posts at the end of this module, as Channels' leads do to message theirs.

// A server launched outside a shell may not have the CLI on its PATH, so it falls back to the app's
// own binary, which acts as the CLI only when told to.
const tailscaleApp = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

const statusSchema = z.object({
  Self: z.object({ UserID: z.number() }),
  Peer: z
    .record(
      z.string(),
      z.object({ DNSName: z.string(), OS: z.string(), Online: z.boolean(), UserID: z.number() }),
    )
    .nullish(),
});

/** The origins of the owner's other Macs online on this tailnet, sorted, or none when Tailscale
 *  can't say. */
export function listPeers(): Promise<string[]> {
  return readPeers().catch(() => []);
}

async function readPeers() {
  const { Self, Peer } = statusSchema.parse(
    await readStatus("tailscale").catch(() => readStatus(tailscaleApp)),
  );
  return Object.values(Peer ?? {})
    .filter((peer) => peer.Online && peer.OS === "macOS" && peer.UserID === Self.UserID)
    .map((peer) => `https://${peer.DNSName.replace(/\.$/, "")}`)
    .sort();
}

function readStatus(cli: string) {
  return Bun.$`TAILSCALE_BE_CLI=1 ${cli} status --json`.quiet().json();
}

/** The peers that answer as Toy Box servers, each with the name it gives itself, the release it runs
 *  and the one it has installed. */
export async function getPeerServers() {
  const servers = await Promise.allSettled(
    (await listPeers()).map(async (origin) => ({ origin, ...(await readServer(origin)) })),
  );
  return servers.flatMap((server) => (server.status === "fulfilled" ? [server.value] : []));
}

const serverSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  installedVersion: z.string().nullable(),
});

/** The name a peer gives itself, the release it runs and the one it has installed. */
export function readServer(origin: string) {
  return read(`${origin}/api/v1/server`, serverSchema);
}

/** Reads a peer's resource within the bound, failing unless it answers as a Toy Box server does. */
export async function read<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  return schema.parse(await response.json());
}

/** Posts to a peer within the bound, failing unless it accepts. */
export async function post(url: string, body: unknown, bound: number): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(bound),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
