import type { Hooks } from "crossws";
import { byFeature } from "@/shared/features";

/** A feature's socket service: the hooks serving one connection, bound to what its URL names. */
export type SocketService = (request: Request) => Partial<Hooks> | Promise<Partial<Hooks>>;

/** Each feature's `server/websocket.ts` serves `/socket?service=<feature folder>`,
 * loaded when its first connection arrives. */
const services = byFeature(
  import.meta.glob<SocketService>("../features/*/server/websocket.ts", { import: "default" }),
);
const loaded: Record<string, Promise<SocketService>> = {};

/** Binds a connection to its feature's hooks once, as it upgrades, for its complete lifetime. */
export async function socketHooks(request: Request): Promise<Partial<Hooks>> {
  const service = new URL(request.url).searchParams.get("service");
  if (service === null || !Object.hasOwn(services, service))
    return refuse(400, "Unknown WebSocket service.");

  if (!isSocketOrigin(request)) return refuse(403, "Socket connections must be same-origin.");

  return (await (loaded[service] ??= services[service]()))(request);
}

/** Hooks that turn a socket away before it opens. */
export function refuse(status: number, reason: string): Partial<Hooks> {
  return { upgrade: () => new Response(reason, { status }) };
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
