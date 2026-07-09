import type { Message as SessionMessage } from "@/types";
import { AssistantMessage } from "./AssistantMessage";
import { UserMessage } from "./UserMessage";
import { AgentNotificationMessage } from "./AgentNotificationMessage";

type MessageProps = {
  message: SessionMessage;
  isStreaming: boolean;
  isLast: boolean;
};

export function Message({ message, isStreaming, isLast }: MessageProps) {
  if (message.role === "user") return <UserMessage message={message} />;
  if (message.role === "agent_notification") {
    return <AgentNotificationMessage message={message} />;
  }
  return <AssistantMessage message={message} isStreaming={isStreaming} isLast={isLast} />;
}
