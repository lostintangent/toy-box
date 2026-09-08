import type { QueuedUserMessage } from "@sessions/model";

/** Application composition for feature reactions to Session lifecycle events. */
export function getSessionStreamHooks(sessionId: string) {
  return {
    onUserMessageStarted(message: QueuedUserMessage) {
      void import("@sessions/server/agentHost")
        .then(({ dispatchSessionAgentMentions }) =>
          dispatchSessionAgentMentions(sessionId, message),
        )
        .catch((error) => {
          console.error("Agent message-start hook failed:", error);
        });
    },
  };
}

/** Normalize application addressing before the Session mailbox takes ownership. */
export async function prepareSessionMessage(
  message: QueuedUserMessage,
): Promise<QueuedUserMessage> {
  const { resolveSessionAgentMentions } = await import("@sessions/server/agentHost");
  return resolveSessionAgentMentions(message);
}
