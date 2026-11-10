import type { SocketService } from "@/server/socket";
import { frameSizeSchema } from "../model";
import { screenClientMessageSchema, type ScreenServerMessage } from "../model/protocol";
import { screenRuntime } from "./runtime";

/** Each socket views the screen named in its URL, for as long as it stays open. */
const connect: SocketService = (request) => {
  const params = new URL(request.url).searchParams;
  const screenId = params.get("screen") ?? "";
  const size = { width: Number(params.get("width")), height: Number(params.get("height")) };

  return {
    open: (peer) => screenRuntime.attach(screenId, peer, frameSizeSchema.safeParse(size).data),
    async message(peer, message) {
      try {
        const command = screenClientMessageSchema.parse(message.json());
        switch (command.type) {
          case "ack":
            return screenRuntime.acknowledge(screenId, peer.id, command.sequence);
          case "resize":
            return screenRuntime.resize(screenId, peer.id, command.size);
          case "take-control":
            return await screenRuntime.takeControl(screenId, peer.id);
          case "release-control":
            return await screenRuntime.releaseControl(screenId, peer.id);
          case "input":
            return await screenRuntime.input(screenId, peer.id, command.actions);
        }
      } catch (error) {
        const refusal: ScreenServerMessage = {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        };
        peer.send(JSON.stringify(refusal));
      }
    },
    close: (peer) => screenRuntime.detach(screenId, peer.id),
  };
};

export default connect;
