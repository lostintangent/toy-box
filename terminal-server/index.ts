#!/usr/bin/env bun

/**
 * WebSocket server for terminal functionality using Bun's native PTY support.
 *
 * Usage:
 * - Development: Run directly with `bun run terminal-server/index.ts`
 * - Production: Import `startTerminalServer()` in CLI
 *
 * Features:
 * - One PTY per tab-scoped client (identified by UUID in sessionStorage)
 * - Idle timeout: 30min for inactive sessions
 * - Orphan timeout: 30s grace period for reconnection
 * - Single active WebSocket per PTY (newer connections replace older ones)
 */

import { z } from "zod";
import { PTYManager } from "./pty";
import { DEFAULT_TERMINAL_WS_PORT } from "../src/types";
import type { TerminalClientMessage } from "../src/types";

const positiveInt = z.number().int().positive();
const controlPlaneMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("init"),
    clientId: z.string().min(1),
    cols: positiveInt.optional(),
    rows: positiveInt.optional(),
    shell: z.string().optional(),
  }),
  z.object({
    type: z.literal("resize"),
    cols: positiveInt,
    rows: positiveInt,
  }),
  z.object({
    type: z.literal("close"),
  }),
]);

export interface WebSocketData {
  id: number;
  clientId?: string;
}

function getBinaryInputChunk(message: unknown): Uint8Array | null {
  if (message instanceof Uint8Array) {
    return message;
  }

  if (message instanceof ArrayBuffer) {
    return new Uint8Array(message);
  }

  return null;
}

function parseControlMessage(message: string): TerminalClientMessage | null {
  if (!message) return null;

  try {
    const parsed = JSON.parse(message);
    const result = controlPlaneMessageSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function startTerminalServer(port = DEFAULT_TERMINAL_WS_PORT) {
  const ptyManager = new PTYManager();

  // Give each socket connection a unique ID.
  let wsIdCounter = 0;

  const server = Bun.serve<WebSocketData>({
    port,
    fetch(request, server) {
      if (server.upgrade(request, { data: { id: wsIdCounter++ } })) {
        return;
      }

      return new Response(null, { status: 200 });
    },
    websocket: {
      message(socket, message) {
        // Control messages are JSON strings, and data-plane messages are binary
        const isControlMessage = typeof message === "string";
        if (isControlMessage) {
          const parsed = parseControlMessage(message);
          if (!parsed) {
            console.error("[terminal] Invalid client message");
            return;
          }

          switch (parsed.type) {
            case "init":
              socket.data.clientId = parsed.clientId;
              ptyManager.handleInit(
                socket,
                parsed.clientId,
                parsed.cols,
                parsed.rows,
                parsed.shell,
              );
              break;

            case "resize":
              ptyManager.handleResize(socket.data.clientId!, parsed.cols, parsed.rows);
              break;

            case "close":
              ptyManager.handleClose(socket.data.clientId!);
              break;
          }
        } else {
          const input = getBinaryInputChunk(message);
          if (input && socket.data.clientId) {
            ptyManager.handleInput(socket.data.clientId, input);
          }
        }
      },
      close(socket) {
        // The client disconnected, but we treat that separately from an
        // explicit "close", since they might just be refreshing the page.
        ptyManager.handleDisconnect(socket.data.clientId!, socket.data.id);
      },
    },
  });

  // Return an API that allows the CLI to
  // stop the terminal server along with the web server.
  return {
    stop: async (graceful = true) => {
      ptyManager.dispose();
      await server.stop(graceful);
    },
  };
}

// Development only: Allow running standalone server via Bun
// where the dev script will set the TERMINAL_WS_PORT environment variable.
if (import.meta.main) {
  const port = parseInt(process.env.TERMINAL_WS_PORT!);
  const terminalServer = startTerminalServer(port);

  const shutdown = async () => {
    try {
      await terminalServer.stop();
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
