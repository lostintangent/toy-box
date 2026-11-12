import type { Hooks } from "crossws";
import { byFeature } from "@/shared/features";
import { shutdown } from "@/shared/server/shutdown";
import { isTrustedOrigin } from "./middleware/origin";

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

  // Upgrades are GETs, which the origin middleware passes, and any page may open a socket to any host.
  if (!isTrustedOrigin(request)) return refuse(403, "Cross-site sockets are refused.");

  const connect = await (loaded[service] ??= services[service]());
  return closedAtShutdown(await connect(request));
}

/** A connection's hooks, closing it as the server shuts down so clients reconnect to the next one. */
function closedAtShutdown(hooks: Partial<Hooks>): Partial<Hooks> {
  let unlisten = () => {};
  return {
    ...hooks,
    open(peer) {
      const leave = () => peer.close(1001, "The server is shutting down.");
      shutdown.signal.addEventListener("abort", leave, { once: true });
      unlisten = () => shutdown.signal.removeEventListener("abort", leave);
      const opened = hooks.open?.(peer);
      if (shutdown.signal.aborted) leave();
      return opened;
    },
    close(peer, details) {
      unlisten();
      return hooks.close?.(peer, details);
    },
  };
}

/** Hooks that turn a socket away before it opens. */
export function refuse(status: number, reason: string): Partial<Hooks> {
  return { upgrade: () => new Response(reason, { status }) };
}
