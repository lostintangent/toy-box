import { Markdown } from "@/shared/ui/markdown";
import { StickToBottom } from "use-stick-to-bottom";
import { RunningIndicator } from "@/shared/ui/running-indicator";
import type { SessionStatus } from "../../model";

export function StatusIndicator({ status }: { status: SessionStatus }) {
  const getStatusText = () => {
    switch (status) {
      case "thinking":
        return "Thinking";
      case "compacting":
        return "Compacting";
      case "reasoning":
        return "Reasoning";
      case "responding":
        return "Responding";
      default:
        return "Processing";
    }
  };

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <RunningIndicator className="h-4 w-4" />
      <span className="italic">{getStatusText()}</span>
    </div>
  );
}

export function ReasoningDisplay({ content }: { content: string }) {
  return (
    <StickToBottom
      className="rounded-lg border border-border/50 bg-secondary-background"
      resize="smooth"
    >
      <StickToBottom.Content className="p-3" scrollClassName="!h-auto max-h-32">
        <Markdown
          mode="streaming"
          isAnimating={true}
          className="text-xs text-muted-foreground italic"
        >
          {content}
        </Markdown>
      </StickToBottom.Content>
    </StickToBottom>
  );
}
