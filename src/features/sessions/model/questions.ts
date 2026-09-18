import type { Message } from "./index";

export function hasPendingSessionQuestion(
  session: { messages: readonly Message[] },
  requestId: string,
): boolean {
  return session.messages.some(
    (message) =>
      message.role === "assistant" &&
      message.toolCalls?.some(
        (toolCall) =>
          toolCall.question?.state === "pending" && toolCall.question.requestId === requestId,
      ) === true,
  );
}

export function hasBlockingSessionQuestion(session: { messages: readonly Message[] }): boolean {
  return session.messages.some(
    (message) =>
      message.role === "assistant" &&
      message.toolCalls?.some(
        (toolCall) =>
          toolCall.question?.state === "pending" && toolCall.question.blocking !== false,
      ) === true,
  );
}
