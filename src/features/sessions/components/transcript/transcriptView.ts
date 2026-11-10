import type { Message } from "../../model";
import type { Settings } from "@workspace/model/config/settings";

export type TranscriptView = Settings["defaultSessionView"];

/** The messages a view shows, with each one's position in the whole transcript. */
export function messagesInView(messages: Message[], view: TranscriptView, messageOffset = 0) {
  const shown = { messages: [] as Message[], positions: [] as number[] };
  messages.forEach((message, index) => {
    const inView = view === "all" ? message : responseInView(message);
    if (!inView) return;
    shown.messages.push(inView);
    shown.positions.push(messageOffset + index);
  });
  return shown;
}

/** Questions and their answers are conversation, even though providers carry them as tool calls. */
function responseInView(message: Message): Message | undefined {
  if (message.role === "user") return message;
  if (message.role === "system") return undefined;

  const toolCalls = message.toolCalls?.filter((toolCall) => toolCall.question);
  return message.content || message.error || toolCalls?.length
    ? { ...message, toolCalls }
    : undefined;
}
