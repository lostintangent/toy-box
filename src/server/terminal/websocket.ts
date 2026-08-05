import { z } from "zod";
import type { Hooks, Peer } from "crossws";
import type { TerminalClientMessage } from "@/types";
import { terminalRuntime } from "./runtime";

const positiveInt = z.number().int().positive();
const controlMessageSchema = z.discriminatedUnion("type", [
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
  z.object({ type: z.literal("close") }),
]);

export const terminalWebSocket = {
  message(peer, message) {
    if (typeof message.rawData !== "string") {
      const clientId = getClientId(peer);
      if (clientId) terminalRuntime.handleInput(clientId, message.uint8Array());
      return;
    }

    const control = parseControlMessage(message.rawData);
    if (!control) {
      console.error("[terminal] Invalid client message");
      return;
    }

    switch (control.type) {
      case "init":
        peer.context.terminalClientId = control.clientId;
        terminalRuntime.handleInit(
          peer,
          control.clientId,
          control.cols,
          control.rows,
          control.shell,
        );
        break;
      case "resize": {
        const clientId = getClientId(peer);
        if (clientId) terminalRuntime.handleResize(clientId, control.cols, control.rows);
        break;
      }
      case "close": {
        const clientId = getClientId(peer);
        if (clientId) terminalRuntime.handleClose(clientId);
        break;
      }
    }
  },
  close(peer) {
    const clientId = getClientId(peer);
    if (clientId) terminalRuntime.handleDisconnect(clientId, peer.id);
  },
  error(_peer, error) {
    console.error("[terminal] WebSocket error:", error);
  },
} satisfies Partial<Hooks>;

function getClientId(peer: Peer): string | undefined {
  const clientId = peer.context.terminalClientId;
  return typeof clientId === "string" ? clientId : undefined;
}

function parseControlMessage(message: string): TerminalClientMessage | null {
  if (!message) return null;

  try {
    const result = controlMessageSchema.safeParse(JSON.parse(message));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
