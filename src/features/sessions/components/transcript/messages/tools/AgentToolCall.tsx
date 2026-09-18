import { Bot } from "lucide-react";
import type { ToolCallProps } from "./types";
import { ToolCallCard } from "./ToolCallCard";
import { TextBlock } from "./TextBlock";
import { MarkdownBlock } from "./MarkdownBlock";
import { ToolCallMessage } from "./ToolCallMessage";
import { ReasoningDisplay } from "../../SessionStatus";

export function AgentToolCall({ toolCall, ...props }: ToolCallProps) {
  const agentType = toolCall.arguments.agent_type as string | undefined;
  const description = toolCall.arguments.description as string | undefined;
  const prompt = toolCall.arguments.prompt as string | undefined;

  const agentLabel = agentType ? `Agent (${agentType})` : "Agent";
  const label = description ? `${agentLabel}: ${description}` : agentLabel;

  const isBackground = toolCall.arguments.mode === "background";
  const model = toolCall.subagent?.model?.name;
  const subagentContent = toolCall.subagent?.content;
  const reasoningContent = toolCall.subagent?.reasoningContent;
  const subagentToolCalls = toolCall.subagent?.toolCalls;
  const promptTitle = model ? `Prompt (${model})` : "Prompt";
  const result = toolCall.result?.content;

  return (
    <ToolCallCard
      {...props}
      toolCall={toolCall}
      icon={Bot}
      label={label}
      headerExtra={
        <span className="text-2xs font-medium text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
          {subagentToolCalls?.length ?? 0}
        </span>
      }
    >
      {reasoningContent && <ReasoningDisplay content={reasoningContent} />}
      {subagentToolCalls && subagentToolCalls.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground mb-1">Tool Calls</div>
          {subagentToolCalls.map((child) => (
            <ToolCallMessage
              key={child.id}
              toolCall={child}
              isActive={child.result === undefined && props.isActive}
            />
          ))}
        </div>
      )}
      <TextBlock title={promptTitle} maxHeight="max-h-32">
        {prompt}
      </TextBlock>
      {subagentContent ? (
        <MarkdownBlock title="Result">{subagentContent}</MarkdownBlock>
      ) : (
        !isBackground && result && <MarkdownBlock title="Result">{result}</MarkdownBlock>
      )}
    </ToolCallCard>
  );
}
