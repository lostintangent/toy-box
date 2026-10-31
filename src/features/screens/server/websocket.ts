import type { Hooks, Peer } from "crossws";
import { screenClientMessageSchema, type ScreenServerMessage } from "../model/protocol";
import { screenRuntime } from "./runtime";

/** Each socket views the screen named in its URL, for as long as it stays open. */
export default {
  open(peer) {
    screenRuntime.attach(screenIdOf(peer), peer);
  },
  async message(peer, message) {
    const screenId = screenIdOf(peer);
    try {
      const command = screenClientMessageSchema.parse(message.json());
      switch (command.type) {
        case "ack":
          return screenRuntime.acknowledge(screenId, peer.id, command.sequence);
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
  close(peer) {
    screenRuntime.detach(screenIdOf(peer), peer.id);
  },
} satisfies Partial<Hooks>;

function screenIdOf(peer: Peer): string {
  return new URL(peer.request.url).searchParams.get("screen") ?? "";
}
