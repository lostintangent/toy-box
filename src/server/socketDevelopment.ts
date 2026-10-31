import type { Plugin } from "vite";
import crossws from "crossws/adapters/bun";

/**
 * Serves `/socket` during development. Nitro serves it in production, but in development
 * it upgrades sockets through crossws's Node adapter, which refuses to run on Bun. So this
 * plugin listens with Bun itself, in Vite's process alongside RPC and agent tools, and
 * Vite proxies `/socket` to it. It installs no signal handlers: Nitro owns Ctrl+C.
 *
 * Delete this plugin, and enable Nitro's `features.websocket` in development too, once
 * crossws's Node adapter accepts Bun's `node:http` upgrades. Only its environment check
 * prevents that: the `ws` server it wraps already handles them on Bun.
 */
export function socketDevelopment(): Plugin {
  let listener: ReturnType<typeof Bun.serve> | undefined;
  return {
    name: "toy-box:websocket-development",
    apply: "serve",
    async config() {
      // Bun loads the gateway here, outside Vite, so expand its glob as Vite would.
      await import(/* @vite-ignore */ new URL("./importMetaGlob.ts", import.meta.url).href);
      const { socketHooks } = (await import(
        /* @vite-ignore */ new URL("./socket.ts", import.meta.url).href
      )) as typeof import("./socket");
      const sockets = crossws({ hooks: socketHooks });
      listener = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        websocket: sockets.websocket,
        fetch: (request, server) =>
          request.headers.get("upgrade") === "websocket"
            ? sockets.handleUpgrade(request, server)
            : new Response(null, { status: 426 }),
      });
      const target = listener.url.href.replace(/^http/, "ws");
      return { server: { proxy: { "/socket": { target, ws: true } } } };
    },
    configureServer(vite) {
      vite.httpServer?.once("close", () => void listener?.stop(true));
    },
  };
}
