import { Loader2 } from "lucide-react";
import { Streamdown } from "streamdown";
import { StickToBottom } from "use-stick-to-bottom";
import type { SessionStatus } from "@/types";

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
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="italic">{getStatusText()}</span>
    </div>
  );
}

export function ReasoningDisplay({ content }: { content: string }) {
  return (
    <StickToBottom className="rounded-lg bg-muted/50 border border-border/50" resize="smooth">
      <StickToBottom.Content className="p-3" scrollClassName="!h-auto max-h-32">
        <Streamdown
          isAnimating={true}
          className="text-xs text-muted-foreground italic [&_p]:my-1 [&_pre]:my-1 [&_ul]:my-1 [&_ol]:my-1"
        >
          {content}
        </Streamdown>
      </StickToBottom.Content>
    </StickToBottom>
  );
}
