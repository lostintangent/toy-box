import { Globe } from "lucide-react";
import type { ToolCallProps } from "./types";
import { ToolCallCard } from "./ToolCallCard";
import { TextBlock } from "./TextBlock";

export function WebFetchToolCall({ toolCall, ...props }: ToolCallProps) {
  const url = (toolCall.arguments.url as string) || "Unknown URL";

  return (
    <ToolCallCard {...props} toolCall={toolCall} icon={Globe} label={url}>
      <TextBlock maxHeight="max-h-64">{toolCall.result?.content}</TextBlock>
    </ToolCallCard>
  );
}
