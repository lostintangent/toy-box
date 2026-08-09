import { SquareTerminal } from "lucide-react";
import type { ToolCallProps } from "./types";
import { ToolCallCard } from "./ToolCallCard";
import { TextBlock } from "./TextBlock";

export function BashToolCall({ toolCall, ...props }: ToolCallProps) {
  const description = (toolCall.arguments.description as string) || "Running command...";
  const command = toolCall.arguments.command as string | undefined;

  return (
    <ToolCallCard {...props} toolCall={toolCall} icon={SquareTerminal} label={description}>
      <TextBlock title="Command" maxHeight="max-h-32">
        {command}
      </TextBlock>
      <TextBlock title="Results">{toolCall.result?.content}</TextBlock>
    </ToolCallCard>
  );
}
