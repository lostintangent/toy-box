import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import * as m from "motion/react-m";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import type { Message as SessionTranscriptMessage, SessionStatus } from "../../model";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { ScrollToBottomButton } from "@/shared/ui/scroll-to-bottom-button";
import { TranscriptPlaceholder } from "./TranscriptPlaceholder";
import { Message } from "./messages/Message";
import { queuedMessageLayoutId } from "../composer/QueuedMessageList";
import { ReasoningDisplay, StatusIndicator } from "./SessionStatus";
import { messagesInView, type TranscriptView } from "./transcriptView";
import {
  createMessageWindow,
  reconcileMessageWindow,
  revealPreviousMessageWindow,
} from "./virtualization";

type PendingMessageAnchor = {
  position: number;
  viewportOffset: number;
};

function isRenderableMessage(message: SessionTranscriptMessage): boolean {
  return (
    message.role !== "assistant" ||
    Boolean(message.content || message.error || (message.toolCalls?.length ?? 0) > 0)
  );
}

export function SessionMessageList({
  messages,
  messageOffset = 0,
  onLoadPrevious,
  view = "all",
  isStreaming,
  isWaiting,
  status,
  reasoningContent,
  scrollToBottomRef,
}: {
  messages: SessionTranscriptMessage[];
  messageOffset?: number;
  onLoadPrevious?: () => void;
  view?: TranscriptView;
  isStreaming: boolean;
  isWaiting: boolean;
  status: SessionStatus;
  reasoningContent: string;
  scrollToBottomRef: MutableRefObject<(() => void) | null>;
}) {
  if (messages.length === 0) return <TranscriptPlaceholder />;

  return (
    <StickToBottom
      key={view}
      className="h-full bg-panel relative"
      resize={isStreaming ? "smooth" : "instant"}
      initial={false}
    >
      <VirtualizedMessageList
        {...messagesInView(messages, view, messageOffset)}
        messageOffset={messageOffset}
        onLoadPrevious={onLoadPrevious}
        isStreaming={isStreaming}
        isWaiting={isWaiting}
        status={status}
        reasoningContent={view === "all" ? reasoningContent : ""}
        scrollToBottomRef={scrollToBottomRef}
      />
      <SessionScrollToBottomButton />
    </StickToBottom>
  );
}

function SessionScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return (
    <ScrollToBottomButton isAtBottom={isAtBottom} onScrollToBottom={() => void scrollToBottom()} />
  );
}

function VirtualizedMessageList({
  messages,
  positions,
  messageOffset,
  onLoadPrevious,
  isStreaming,
  isWaiting,
  status,
  reasoningContent,
  scrollToBottomRef,
}: {
  messages: SessionTranscriptMessage[];
  positions: number[];
  messageOffset: number;
  onLoadPrevious?: () => void;
  isStreaming: boolean;
  isWaiting: boolean;
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
  const [messageWindow, setMessageWindow] = useState(() => createMessageWindow(positions));

  // Reconcile before commit so an append or replacement never paints with stale bounds.
  const renderedWindow = reconcileMessageWindow(messageWindow, positions, isAtBottom);
  if (renderedWindow !== messageWindow) setMessageWindow(renderedWindow);

  const { startPosition } = renderedWindow;
  const startIndex = positions.findIndex((position) => position >= startPosition);
  const hasHiddenMessages = startIndex > 0;
  const hasPreviousMessages = hasHiddenMessages || messageOffset > 0;
  const previousStartPositionRef = useRef(startPosition);

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
    if (pendingAnchorRef.current) return;
    if (!hasHiddenMessages) return onLoadPrevious?.();

    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;

    // The sentinel can intersect before a touch/programmatic scroll event has
    // escaped the bottom lock. History anchoring owns this resize transition.
    stopScroll();

    const anchorEl = contentEl.querySelector<HTMLElement>("[data-message-position]");
    if (anchorEl) {
      pendingAnchorRef.current = {
        position: Number(anchorEl.dataset.messagePosition),
        viewportOffset: anchorEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top,
      };
    }

    setMessageWindow((current) => revealPreviousMessageWindow(current, positions));
  });

  // Reveal the previous window before its sentinel reaches the visible scroll viewport.
  // Reaching the first loaded message, or loading a page, observes again, since the
  // sentinel may still be in view and must then load or reveal the next messages.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const sentinelEl = historySentinelRef.current;
    if (!hasPreviousMessages || !scrollEl || !sentinelEl) return;

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
  }, [messageOffset, hasPreviousMessages, hasHiddenMessages, scrollRef]);

  // Anchor prepended history in place, or keep an advancing tail window pinned before paint.
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    const previousStartPosition = previousStartPositionRef.current;
    previousStartPositionRef.current = startPosition;
    if (!scrollEl || !contentEl) return;

    const pendingAnchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (pendingAnchor) {
      const anchorEl = contentEl.querySelector<HTMLElement>(
        `[data-message-position="${pendingAnchor.position}"]`,
      );
      if (!anchorEl) return;

      const nextViewportOffset =
        anchorEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
      scrollEl.scrollTop += nextViewportOffset - pendingAnchor.viewportOffset;
      return;
    }

    // Crossing the window boundary removes old rows above the viewport. Keep
    // the latest output pinned before paint when the reader was already there.
    if (startPosition > previousStartPosition && isAtBottom) {
      void scrollToBottom({ animation: "instant", ignoreEscapes: true });
    }
  }, [isAtBottom, scrollRef, scrollToBottom, startPosition]);

  return (
    <ScrollableFade ref={scrollRef} axis="vertical" rootClassName="size-full">
      <div ref={stickToBottomContentRef} className="@container space-y-4 overflow-x-hidden p-4">
        <div
          ref={contentRef}
          className="space-y-3"
          data-message-window-start-index={startIndex}
          style={{ opacity: 0 }}
        >
          {hasPreviousMessages && (
            <div ref={historySentinelRef} className="h-px" aria-hidden="true" />
          )}

          {messages.slice(startIndex).map((message, index) => {
            const position = positions[startIndex + index];
            if (!isRenderableMessage(message)) return null;

            const isLast = startIndex + index === messages.length - 1;
            const content = (
              <Message
                message={message}
                isStreaming={isStreaming}
                isBusy={isStreaming && status !== "background"}
                isLast={isLast}
              />
            );
            return (
              <div key={`${message.role}-${position}`} data-message-position={position}>
                {message.role === "user" && message.clientId ? (
                  // A user message shares identity with the queued row it came from, so it
                  // travels up from the composer when sent. A fixed layout dependency limits
                  // animation to that arrival, never later updates or scrolling.
                  <m.div
                    layoutId={queuedMessageLayoutId(message.clientId)}
                    layout="position"
                    layoutDependency={message.clientId}
                  >
                    {content}
                  </m.div>
                ) : (
                  content
                )}
              </div>
            );
          })}

          {isStreaming && reasoningContent && <ReasoningDisplay content={reasoningContent} />}
          {isStreaming && !isWaiting && status !== "idle" && <StatusIndicator status={status} />}
        </div>
      </div>
    </ScrollableFade>
  );
}
