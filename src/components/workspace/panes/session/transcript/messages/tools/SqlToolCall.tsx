import { Database } from "lucide-react";
import type { ToolCallProps } from "./types";
import { ToolCallCard } from "./ToolCallCard";
import { TextBlock } from "./TextBlock";

export function SqlToolCall({ toolCall, ...props }: ToolCallProps) {
  const description = (toolCall.arguments.description as string) || "SQL Query";
  const query = toolCall.arguments.query as string;

  return (
    <ToolCallCard {...props} toolCall={toolCall} icon={Database} label={description}>
      <TextBlock title="Query" maxHeight="max-h-32">
        {query}
      </TextBlock>
      <TextBlock title="Result">{toolCall.result?.content}</TextBlock>
    </ToolCallCard>
  );
}
