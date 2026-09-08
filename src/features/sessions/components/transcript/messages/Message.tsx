import type { Message as SessionMessage } from "../../../model";
import { AssistantMessage } from "./AssistantMessage";
import { SessionUserMessage } from "./SessionUserMessage";
import { SystemMessage } from "./SystemMessage";

type MessageProps = {
  message: SessionMessage;
  isStreaming: boolean;
  isLast: boolean;
};

export function Message({ message, isStreaming, isLast }: MessageProps) {
  if (message.role === "user") return <SessionUserMessage message={message} />;
  if (message.role === "system") return <SystemMessage message={message} />;
  return <AssistantMessage message={message} isStreaming={isStreaming} isLast={isLast} />;
}
