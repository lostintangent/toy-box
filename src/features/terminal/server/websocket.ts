import { getSettings } from "@workspace/server/state/settings";
import { refuse, type SocketService } from "@/server/socket";
import {
  terminalAttachSchema,
  terminalClientMessageSchema,
  type TerminalClientMessage,
} from "../model/protocol";
import { terminalRuntime } from "./runtime";

/** Each socket shows the PTY of the tab its URL names, starting one in the owner's chosen shell. */
const connect: SocketService = async (request) => {
  const attach = terminalAttachSchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!attach.success) return refuse(400, "A terminal socket names its tab.");
  const { clientId, cols, rows } = attach.data;
  const shell = (await getSettings()).terminalShell.trim() || undefined;

  return {
    open: (peer) => terminalRuntime.attach(peer, clientId, cols, rows, shell),
    message(_peer, message) {
      if (typeof message.rawData !== "string")
        return terminalRuntime.input(clientId, message.uint8Array());

      let control: TerminalClientMessage;
      try {
        control = terminalClientMessageSchema.parse(message.json());
      } catch {
        return console.error("[terminal] Invalid client message");
      }
      if (control.type === "close") return terminalRuntime.close(clientId);
      terminalRuntime.resize(clientId, control.cols, control.rows);
    },
    close: (peer) => terminalRuntime.detach(clientId, peer.id),
    error: (_peer, error) => console.error("[terminal] WebSocket error:", error),
  };
};

export default connect;
