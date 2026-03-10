import { Bot } from "lucide-react";
import type { ToolCallProps } from "./types";
import { ToolCallCard } from "./ToolCallCard";
import { TextBlock } from "./TextBlock";
import { MarkdownBlock } from "./MarkdownBlock";
import { ToolCallMessage } from "./ToolCallMessage";

export function AgentToolCall({ toolCall, ...props }: ToolCallProps) {
  const agentType = toolCall.arguments.agent_type as string | undefined;
  const description = toolCall.arguments.description as string | undefined;
  const prompt = toolCall.arguments.prompt as string | undefined;

  const agentLabel = agentType ? `Agent (${agentType})` : "Agent";
  const label = description ? `${agentLabel}: ${description}` : agentLabel;

  const isBackground = toolCall.arguments.mode === "background";

  return (
    <ToolCallCard
      {...props}
      toolCall={toolCall}
      icon={Bot}
      label={label}
      headerExtra={
        <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
          {toolCall.childToolCalls?.length ?? 0}
        </span>
      }
    >
      {toolCall.childToolCalls && toolCall.childToolCalls.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground mb-1">Tool Calls</div>
          {toolCall.childToolCalls.map((child) => (
            <ToolCallMessage
              key={child.toolCallId}
              toolCall={child}
              isActive={!child.result && props.isActive}
            />
          ))}
        </div>
      )}
      <TextBlock title="Prompt" maxHeight="max-h-32">
        {prompt}
      </TextBlock>
      {!isBackground && <MarkdownBlock title="Result">{toolCall.result?.content}</MarkdownBlock>}
    </ToolCallCard>
  );
}
