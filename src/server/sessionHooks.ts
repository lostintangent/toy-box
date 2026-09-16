import type { QueuedUserMessage } from "@sessions/model";

/** Compose application behavior into the generic Session runtime lifecycle. */
export function getSessionStreamHooks(sessionId: string) {
  return {
    onUserMessageSubmitted(message: QueuedUserMessage) {
      void import("@sessions/server/agentHost")
        .then(({ dispatchSessionAgentMentions }) =>
          dispatchSessionAgentMentions(sessionId, message),
        )
        .catch((error) => {
          console.error("Agent message submission failed:", error);
        });
    },
  };
}

/** Prepare application addressing before the Session mailbox accepts a message. */
export async function prepareSessionMessage(
  message: QueuedUserMessage,
): Promise<QueuedUserMessage> {
  const { resolveSessionAgentMentions } = await import("@sessions/server/agentHost");
  return resolveSessionAgentMentions(message);
}
