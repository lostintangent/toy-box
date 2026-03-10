import { useMemo } from "react";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import type { AssistantMessage as AssistantMessageType, ToolCall } from "@/types";
import { ToolCallMessage } from "./tools/ToolCallMessage";

// ============================================================================
// Assistant Message Component
// ============================================================================

export function AssistantMessage({
  message,
  isStreaming,
}: {
  message: AssistantMessageType;
  isStreaming: boolean;
}) {
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;

  // Skip rendering empty assistant messages (no content AND no tool calls)
  if (!message.content && !hasToolCalls) {
    return null;
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-full @md:max-w-[80%]">
        <div className="space-y-2">
          {/* Text content */}
          {message.content ? (
            <Streamdown
              isAnimating={isStreaming}
              plugins={{ code }}
              className="text-sm [&_p]:my-2 [&_pre]:my-2 [&_ul]:my-2 [&_ol]:my-2"
            >
              {message.content}
            </Streamdown>
          ) : null}
          {/* Tool calls display */}
          {hasToolCalls && <ToolCallsDisplay toolCalls={message.toolCalls!} />}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Tool Calls Display Component
// ============================================================================

/** Deduplicates adjacent report_intent calls with the same value. */
function deduplicateIntents(toolCalls: ToolCall[]): ToolCall[] {
  let lastIntentValue: string | null = null;
  return toolCalls.filter((tc) => {
    if (tc.toolName === "report_intent") {
      const value = tc.arguments?.intent as string;
      if (value === lastIntentValue) return false;
      lastIntentValue = value;
    }
    return true;
  });
}

function IntentDivider({ intent }: { intent: string }) {
  return (
    <div className="flex items-center gap-1 pt-1 pb-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/70">
        {intent}
      </span>
    </div>
  );
}

function ToolCallsDisplay({ toolCalls }: { toolCalls: ToolCall[] }) {
  const deduplicated = useMemo(() => deduplicateIntents(toolCalls), [toolCalls]);

  return (
    <div className="space-y-2">
      {deduplicated.map((toolCall) => {
        if (toolCall.toolName === "report_intent") {
          const intent = (toolCall.arguments?.intent as string) || "Working...";
          return <IntentDivider key={toolCall.toolCallId} intent={intent} />;
        }

        return (
          <ToolCallMessage
            key={toolCall.toolCallId}
            toolCall={toolCall}
            isActive={!toolCall.result}
          />
        );
      })}
    </div>
  );
}
