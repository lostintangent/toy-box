import type { ChannelAgent, ChannelAgentStatus } from ".";

/**
 * How an agent appears to the rest of the Channel. A running session is working. An idle agent can
 * still be waiting on someone. Runtime activity wins while turn-start and turn-end writes settle.
 */
export type ChannelAgentPresence =
  | { state: "working"; text?: string }
  | Extract<ChannelAgentStatus, { state: "waiting" }>
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
