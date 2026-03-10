import { memo } from "react";
import type { Message as SessionMessage } from "@/types";
import { AssistantMessage } from "./AssistantMessage";
import { UserMessage } from "./UserMessage";

type MessageProps = {
  message: SessionMessage;
  isStreaming: boolean;
  revision?: number;
};

export const Message = memo(({ message, isStreaming }: MessageProps) => {
  return message.role === "user" ? (
    <UserMessage message={message} />
  ) : (
    <AssistantMessage message={message} isStreaming={isStreaming} />
  );
});
