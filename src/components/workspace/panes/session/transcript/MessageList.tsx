import { memo, useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import { ArrowDown, Bot } from "lucide-react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import type { Message, SessionStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Message as SessionMessage } from "./messages/Message";
import { ReasoningDisplay, StatusIndicator } from "./SessionStatus";

export function SessionMessagesSkeleton() {
  return (
    <div className="h-full space-y-4 p-4 bg-muted/50">
      <div className="flex justify-end">
        <Skeleton className="h-10 w-48 rounded-lg" />
      </div>
      <div className="flex justify-start">
        <div className="space-y-2">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      <div className="flex justify-start">
        <div className="space-y-2">
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-52 rounded-lg" />
      </div>
      <div className="flex justify-start">
        <div className="space-y-2">
          <Skeleton className="h-4 w-60" />
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-4 w-44" />
        </div>
      </div>
    </div>
  );
}

export const SessionMessageList = memo(function SessionMessageList({
  messages,
  isStreaming,
  status,
  reasoningContent,
  revision,
  scrollToBottomRef,
}: {
  messages: Message[];
  isStreaming: boolean;
  status: SessionStatus;
  reasoningContent: string;
  revision: number;
  scrollToBottomRef: MutableRefObject<(() => void) | null>;
}) {
  if (messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-muted/50 p-8">
        <div className="text-center space-y-4">
          <Bot className="h-16 w-16 mx-auto text-muted-foreground/50" />
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-foreground">What would you like to build?</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Ask a question or describe your idea below
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <StickToBottom
      className="h-full bg-muted/50 relative"
      resize={isStreaming ? "smooth" : "instant"}
      initial={false}
    >
      <MessageListContent
        messages={messages}
        isStreaming={isStreaming}
        status={status}
        reasoningContent={reasoningContent}
        revision={revision}
        scrollToBottomRef={scrollToBottomRef}
      />
      <ScrollToBottomButton />
    </StickToBottom>
  );
});

function MessageListContent({
  messages,
  isStreaming,
  status,
  reasoningContent,
  revision,
  scrollToBottomRef,
}: {
  messages: Message[];
  isStreaming: boolean;
  status: SessionStatus;
  reasoningContent: string;
  revision: number;
  scrollToBottomRef: MutableRefObject<(() => void) | null>;
}) {
  const { scrollRef, scrollToBottom } = useStickToBottomContext();
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollToBottomRef.current = scrollToBottom;
  }, [scrollToBottom, scrollToBottomRef]);

  // The library's first ResizeObserver scroll happens after paint; position
  // the list synchronously to avoid a visible jump on long sessions.
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;

    scrollEl.scrollTop = scrollEl.scrollHeight;
    contentEl.style.opacity = "1";
    void scrollToBottom({ animation: "instant", ignoreEscapes: true });
  }, [scrollRef, scrollToBottom]);

  return (
    <StickToBottom.Content className="@container space-y-4 p-4 overflow-x-hidden">
      <div ref={contentRef} className="space-y-3" style={{ opacity: 0 }}>
        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          return (
            <SessionMessage
              // eslint-disable-next-line react/no-array-index-key -- messages append in order and streaming updates replace content in place
              key={`${message.role}-${index}`}
              message={message}
              isStreaming={isStreaming}
              isLast={isLast}
              revision={
                isLast ? revision : message.role === "assistant" ? message.revision : undefined
              }
            />
          );
        })}

        {isStreaming && reasoningContent && <ReasoningDisplay content={reasoningContent} />}
        {isStreaming && status !== "idle" && <StatusIndicator status={status} />}
      </div>
    </StickToBottom.Content>
  );
}

function ScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  if (isAtBottom) return null;

  return (
    <Button
      variant="secondary"
      className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-lg bg-background"
      onClick={() => scrollToBottom()}
    >
      <ArrowDown className="h-4 w-4" />
      Scroll down
    </Button>
  );
}
