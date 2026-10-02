import type { ChannelAgent } from ".";

/**
 * How an agent appears to the rest of the Channel. A running session is working. An idle agent can
 * still be waiting on someone, while a working status left behind by a finished turn means nothing.
 */
export type ChannelAgentPresence =
  | { state: "working"; text?: string }
  | { state: "waiting"; text: string; wakeAt?: string }
  | { state: "idle" };

export function channelAgentPresence(
  { status }: Pick<ChannelAgent, "status">,
  running: boolean,
): ChannelAgentPresence {
  if (running) {
    return status?.state === "working"
      ? { state: "working", text: status.text }
      : { state: "working" };
  }
  return status?.state === "waiting" ? status : { state: "idle" };
}
