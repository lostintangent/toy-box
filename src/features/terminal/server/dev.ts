import { serve } from "crossws/server/bun";
import { terminalRuntime } from "./runtime";
import { terminalWebSocket } from "./websocket";

const server = serve({
  port: Number(process.env.TERMINAL_WS_PORT ?? 3101),
  fetch: () => new Response(null, { status: 404 }),
  websocket: terminalWebSocket,
});

const shutdown = async () => {
  terminalRuntime.dispose();
  await server.close(true);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
