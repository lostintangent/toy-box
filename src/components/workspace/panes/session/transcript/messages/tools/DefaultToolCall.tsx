import type { ToolCallProps } from "./types";
import { ToolCallCard } from "./ToolCallCard";
import { TextBlock } from "./TextBlock";

// Fallback display name for tools without a bespoke renderer: turn a snake_case
// tool name like `register_artifact_kind` into "Register artifact kind".
function formatToolName(name: string): string {
  const spaced = name.replace(/_/g, " ").trim();
  if (!spaced) return name;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function DefaultToolCall({ toolCall, ...props }: ToolCallProps) {
  const hasArgs = Object.keys(toolCall.arguments).length > 0;

  return (
    <ToolCallCard {...props} toolCall={toolCall} label={formatToolName(toolCall.name)}>
      <TextBlock title="Arguments" maxHeight="max-h-32">
        {hasArgs ? JSON.stringify(toolCall.arguments, null, 2) : null}
      </TextBlock>
      <TextBlock title="Result">{toolCall.result?.content}</TextBlock>
    </ToolCallCard>
  );
}
