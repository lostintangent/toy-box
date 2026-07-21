import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { ArrowDown, Bot } from "lucide-react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import type { Message, SessionStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { ScrollableFade } from "@/components/ui/scrollable-fade";
import { Skeleton } from "@/components/ui/skeleton";
import { Message as SessionMessage } from "./messages/Message";
import { ReasoningDisplay, StatusIndicator } from "./SessionStatus";
import {
  createMessageWindow,
  reconcileMessageWindow,
  revealPreviousMessageWindow,
} from "./virtualization";

type PendingMessageAnchor = {
  messageIndex: number;
  viewportOffset: number;
};

function isRenderableMessage(message: Message): boolean {
  return (
    message.role !== "assistant" || Boolean(message.content || (message.toolCalls?.length ?? 0) > 0)
  );
}

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

export function SessionMessageList({
  messages,
  isStreaming,
  status,
  reasoningContent,
  scrollToBottomRef,
}: {
  messages: Message[];
  isStreaming: boolean;
  status: SessionStatus;
  reasoningContent: string;
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
      <VirtualizedMessageList
        messages={messages}
        isStreaming={isStreaming}
        status={status}
        reasoningContent={reasoningContent}
        scrollToBottomRef={scrollToBottomRef}
      />
      <ScrollToBottomButton />
    </StickToBottom>
  );
}

function VirtualizedMessageList({
  messages,
  isStreaming,
  status,
  reasoningContent,
  scrollToBottomRef,
}: {
  messages: Message[];
  isStreaming: boolean;
  status: SessionStatus;
  reasoningContent: string;
  scrollToBottomRef: MutableRefObject<(() => void) | null>;
}) {
  const {
    contentRef: stickToBottomContentRef,
    isAtBottom,
    scrollRef,
    scrollToBottom,
    stopScroll,
  } = useStickToBottomContext();
  const contentRef = useRef<HTMLDivElement>(null);
  const historySentinelRef = useRef<HTMLDivElement>(null);
  const pendingAnchorRef = useRef<PendingMessageAnchor | null>(null);
  const [messageWindow, setMessageWindow] = useState(() => createMessageWindow(messages.length));

  // Reconcile before commit so an append or replacement never paints with stale bounds.
  let renderedWindow = messageWindow;
  if (messageWindow.messageCount !== messages.length) {
    renderedWindow = reconcileMessageWindow(messageWindow, messages.length, isAtBottom);
    setMessageWindow(renderedWindow);
  }

  const startIndex = renderedWindow.startIndex;
  const hasEarlierMessages = startIndex > 0;
  const previousStartIndexRef = useRef(startIndex);

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

  const revealPreviousMessages = useEffectEvent(() => {
    if (messageWindow.startIndex === 0 || pendingAnchorRef.current) return;

    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;

    // The sentinel can intersect before a touch/programmatic scroll event has
    // escaped the bottom lock. History anchoring owns this resize transition.
    stopScroll();

    const anchorEl = contentEl.querySelector<HTMLElement>("[data-message-index]");
    if (anchorEl) {
      pendingAnchorRef.current = {
        messageIndex: Number(anchorEl.dataset.messageIndex),
        viewportOffset: anchorEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top,
      };
    }

    setMessageWindow((current) => revealPreviousMessageWindow(current));
  });

  // Reveal the previous window before its sentinel reaches the visible scroll viewport.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const sentinelEl = historySentinelRef.current;
    if (!hasEarlierMessages || !scrollEl || !sentinelEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) revealPreviousMessages();
      },
      {
        root: scrollEl,
        rootMargin: "600px 0px 0px",
      },
    );
    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [hasEarlierMessages, scrollRef]);

  // Anchor prepended history in place, or keep an advancing tail window pinned before paint.
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    const previousStartIndex = previousStartIndexRef.current;
    previousStartIndexRef.current = startIndex;
    if (!scrollEl || !contentEl) return;

    const pendingAnchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (pendingAnchor) {
      const anchorEl = contentEl.querySelector<HTMLElement>(
        `[data-message-index="${pendingAnchor.messageIndex}"]`,
      );
      if (!anchorEl) return;

      const nextViewportOffset =
        anchorEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
      scrollEl.scrollTop += nextViewportOffset - pendingAnchor.viewportOffset;
      return;
    }

    // Crossing the window boundary removes old rows above the viewport. Keep
    // the latest output pinned before paint when the reader was already there.
    if (startIndex > previousStartIndex && isAtBottom) {
      void scrollToBottom({ animation: "instant", ignoreEscapes: true });
    }
  }, [isAtBottom, scrollRef, scrollToBottom, startIndex]);

  return (
    <ScrollableFade asChild axis="vertical" className="h-full w-full">
      <div ref={scrollRef} style={{ scrollbarGutter: "stable both-edges" }}>
        <div ref={stickToBottomContentRef} className="@container space-y-4 overflow-x-hidden p-4">
          <div
            ref={contentRef}
            className="space-y-3"
            data-message-window-start-index={startIndex}
            style={{ opacity: 0 }}
          >
            {hasEarlierMessages && (
              <div ref={historySentinelRef} className="h-px" aria-hidden="true" />
            )}

            {messages.slice(startIndex).map((message, index) => {
              const absoluteIndex = startIndex + index;
              if (!isRenderableMessage(message)) return null;

              const isLast = absoluteIndex === messages.length - 1;
              return (
                <div
                  // eslint-disable-next-line react/no-array-index-key -- messages append in order and streaming updates replace content in place
                  key={`${message.role}-${absoluteIndex}`}
                  data-message-index={absoluteIndex}
                >
                  <SessionMessage message={message} isStreaming={isStreaming} isLast={isLast} />
                </div>
              );
            })}

            {isStreaming && reasoningContent && <ReasoningDisplay content={reasoningContent} />}
            {isStreaming && status !== "idle" && <StatusIndicator status={status} />}
          </div>
        </div>
      </div>
    </ScrollableFade>
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
