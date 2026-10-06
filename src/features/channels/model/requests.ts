import type { ChannelMessage } from ".";

export type ChannelRequestState = "pending" | "acknowledged";

/**
 * Each loaded question stays pending until a later user message acknowledges it.
 */
export function channelRequestStates(
  messages: readonly ChannelMessage[],
): Map<number, ChannelRequestState> {
  const latestUserSequence = messages.reduce(
    (latest, { sender, sequence }) =>
      sender.type === "user" ? Math.max(latest, sequence) : latest,
    0,
  );
  const states = new Map<number, ChannelRequestState>();
  for (const message of messages) {
    if (message.request)
      states.set(
        message.sequence,
        message.sequence > latestUserSequence ? "pending" : "acknowledged",
      );
  }
  return states;
}
