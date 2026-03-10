import type { ToolCallProps } from "./types";
import { ToolCallCard } from "./ToolCallCard";
import { TextBlock } from "./TextBlock";

export function DefaultToolCall({ toolCall, ...props }: ToolCallProps) {
  const hasArgs = Object.keys(toolCall.arguments).length > 0;

  return (
    <ToolCallCard {...props} toolCall={toolCall} label={toolCall.toolName}>
      <TextBlock title="Arguments" maxHeight="max-h-32">
        {hasArgs ? JSON.stringify(toolCall.arguments, null, 2) : null}
      </TextBlock>
      <TextBlock title="Result">{toolCall.result?.content}</TextBlock>
    </ToolCallCard>
  );
}
