import type { Hooks } from "crossws";
import { byFeature } from "@/shared/features";

/** Each feature's `server/websocket.ts` serves `/socket?service=<feature folder>`,
 * loaded when its first connection arrives. */
const services = byFeature(
  import.meta.glob<Partial<Hooks>>("../features/*/server/websocket.ts", { import: "default" }),
);
const loaded: Record<string, Promise<Partial<Hooks>>> = {};

function isService(value: string | null): value is string {
  return value !== null && Object.hasOwn(services, value);
}

async function hooks(request: Request): Promise<Partial<Hooks>> {
  const service = new URL(request.url).searchParams.get("service");
  if (!isService(service)) throw new Error("Unknown WebSocket service.");
  return (loaded[service] ??= services[service]());
}

/**
 * Whether a socket may connect. Browsers let any page open a WebSocket to any host, with no CORS,
 * so a site open in the owner's own browser could otherwise drive their terminal or watch their
 * screens. Tailscale and localhost can't stop that, but a page can't forge its `Origin`, so a
 * browser connects only from this server's own origin.
 */
export function isSocketOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  // Browsers always send one, so a request without is a native client, trusted like `/api`.
  if (!origin) return true;

  try {
    const source = new URL(origin);
    return (
      (source.protocol === "http:" || source.protocol === "https:") &&
      source.host === new URL(request.url).host
    );
  } catch {
    return false;
  }
}

/** Composition only. Each connection is bound to a feature for its complete lifetime. */
export const socketHooks = {
  async upgrade(request) {
    if (!isService(new URL(request.url).searchParams.get("service")))
      return new Response("Unknown WebSocket service.", { status: 400 });

    if (!isSocketOrigin(request))
      return new Response("Socket connections must be same-origin.", { status: 403 });

    return (await hooks(request)).upgrade?.(request);
  },

  async open(peer) {
    return (await hooks(peer.request)).open?.(peer);
  },

  async message(peer, message) {
    return (await hooks(peer.request)).message?.(peer, message);
  },

  async close(peer, details) {
    return (await hooks(peer.request)).close?.(peer, details);
  },

  async error(peer, error) {
    return (await hooks(peer.request)).error?.(peer, error);
  },
} satisfies Partial<Hooks>;
