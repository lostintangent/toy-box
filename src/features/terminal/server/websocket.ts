import type { Hooks, Peer } from "crossws";
import { terminalClientMessageSchema, type TerminalClientMessage } from "../model/protocol";
import { terminalRuntime } from "./runtime";

export default {
  message(peer, message) {
    if (typeof message.rawData !== "string") {
      const clientId = getClientId(peer);
      if (clientId) terminalRuntime.input(clientId, message.uint8Array());
      return;
    }

    let control: TerminalClientMessage;
    try {
      control = terminalClientMessageSchema.parse(message.json());
    } catch {
      console.error("[terminal] Invalid client message");
      return;
    }

    switch (control.type) {
      case "init":
        peer.context.terminalClientId = control.clientId;
        terminalRuntime.attach(peer, control.clientId, control.cols, control.rows, control.shell);
        break;
      case "resize": {
        const clientId = getClientId(peer);
        if (clientId) terminalRuntime.resize(clientId, control.cols, control.rows);
        break;
      }
      case "close": {
        const clientId = getClientId(peer);
        if (clientId) terminalRuntime.close(clientId);
        break;
      }
    }
  },
  close(peer) {
    const clientId = getClientId(peer);
    if (clientId) terminalRuntime.detach(clientId, peer.id);
  },
  error(_peer, error) {
    console.error("[terminal] WebSocket error:", error);
  },
} satisfies Partial<Hooks>;

function getClientId(peer: Peer): string | undefined {
  const clientId = peer.context.terminalClientId;
  return typeof clientId === "string" ? clientId : undefined;
}
