import { isChannelSystemMessage, type ChannelMessage } from ".";

export type ChannelRequestState = "pending" | "acknowledged";

/**
 * Each loaded request's state, keyed by the sequence of the message it references. As with the
 * catalog's `hasPendingRequest`, a request is pending until the user posts after that message.
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
    if (!isChannelSystemMessage(message) || message.content.type !== "user_attention_requested") {
      continue;
    }
    const { requestSequence } = message.content;
    states.set(requestSequence, requestSequence > latestUserSequence ? "pending" : "acknowledged");
  }
  return states;
}
