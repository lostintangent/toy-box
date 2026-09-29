import {
  // eslint-disable-next-line toy-box-react/no-manual-memoization -- TanStack Virtual treats key-extractor identity as measurement state.
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AgentStatus } from "@channels/components/agents/AgentStatus";
import type { ChannelMessage } from "@channels/model";
import { channelRequestStates, type ChannelRequestState } from "@channels/model/requests";
import { TranscriptSkeleton } from "@sessions/components/transcript/TranscriptSkeleton";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { ScrollToBottomButton } from "@/shared/ui/scroll-to-bottom-button";
import { cn } from "@/shared/utils";
import { useChannelPane } from "../ChannelPaneContext";
import { AgentRun } from "./AgentRun";
import { ChannelPlaceholder } from "./ChannelPlaceholder";
import { ChannelUserMessage } from "./ChannelUserMessage";
import { SystemMessageGroup } from "./SystemMessageGroup";
import { transcriptDayLabel, transcriptRows, type TranscriptRow } from "./transcriptRows";

export function ChannelTranscript({
  messages,
  unreadAfter,
  scrollToBottomRef,
  onLoadPrevious,
}: {
  messages: ChannelMessage[];
  /** The read position when the reader arrived, if anything was unread. */
  unreadAfter?: number;
  scrollToBottomRef: RefObject<(() => void) | null>;
  onLoadPrevious: () => Promise<void>;
}) {
  const { agents } = useChannelPane();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAfterAppendRef = useRef(false);
  const jumpedToUnreadRef = useRef(false);
  const [isReady, setIsReady] = useState(messages.length === 0);
  const requests = channelRequestStates(messages);
  const rows = transcriptRows(messages, unreadAfter);
  const rowCount = rows.length;
  const firstUnreadIndex = rows.findIndex((row) => row.startsUnread);
  // A row keeps its first message's identity as later messages join its run.
  const getRowKey = useCallback((index: number) => rows[index]!.messages[0]!.id, [rows]);
  // eslint-disable-next-line react/react-compiler -- TanStack Virtual intentionally owns its mutable instance.
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index]!;
      if (row.type === "system") return 20;
      return row.messages.reduce(
        (height, message) => height + 100 + (message.attachments?.length ? 96 : 0),
        0,
      );
    },
    getItemKey: getRowKey,
    anchorTo: "end",
    followOnAppend: "smooth",
    scrollEndThreshold: 80,
    overscan: 6,
    gap: 20,
    paddingStart: 20,
    paddingEnd: 20,
    directDomUpdates: true,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
    useScrollendEvent: true,
  });

  useImperativeHandle(scrollToBottomRef, () => () => {
    scrollAfterAppendRef.current = true;
  });

  const virtualItems = virtualizer.getVirtualItems();
  const firstVirtualIndex = virtualItems[0]?.index;
  const oldestSequence = messages[0]?.sequence;

  useEffect(() => {
    if (isReady && firstVirtualIndex === 0 && oldestSequence !== undefined && oldestSequence > 1) {
      void onLoadPrevious();
    }
  }, [firstVirtualIndex, isReady, oldestSequence, onLoadPrevious]);

  useLayoutEffect(() => {
    if (isReady) return;
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    if (
      virtualItems.at(-1)?.index === rowCount - 1 &&
      virtualizer.isAtEnd() &&
      !virtualizer.isScrolling
    ) {
      setIsReady(true);
      return;
    }

    // Position directly so no programmatic-scroll reconciliation can outlive initialization.
    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [isReady, rowCount, virtualItems, virtualizer]);

  // Opening a Channel with unread messages lands on where they begin, once, before it paints.
  useLayoutEffect(() => {
    if (!isReady || jumpedToUnreadRef.current) return;
    jumpedToUnreadRef.current = true;
    if (firstUnreadIndex >= 0) virtualizer.scrollToIndex(firstUnreadIndex, { align: "start" });
  }, [firstUnreadIndex, isReady, virtualizer]);

  useLayoutEffect(() => {
    if (!scrollAfterAppendRef.current) return;
    scrollAfterAppendRef.current = false;
    virtualizer.scrollToEnd({ behavior: "smooth" });
  }, [messages.length, virtualizer]);

  return (
    <div className="relative h-full bg-panel">
      {!isReady && <TranscriptSkeleton />}
      <ScrollableFade
        ref={scrollRef}
        axis="vertical"
        rootClassName={cn("size-full", !isReady && "invisible absolute inset-0")}
      >
        {messages.length === 0 ? (
          <div className="@container min-h-full px-4 py-5">
            <ChannelPlaceholder />
            <div className="space-y-2 empty:hidden pt-4">
              <AgentStatus agents={agents} />
            </div>
          </div>
        ) : (
          <div ref={virtualizer.containerRef} className="@container relative min-h-full w-full">
            {virtualItems.map((virtualItem) => {
              const row = rows[virtualItem.index]!;
              const isLast = virtualItem.index === rows.length - 1;
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  className="absolute top-0 left-0 w-full px-4"
                >
                  {row.startsDay && <DayDivider date={row.messages[0]!.timestamp} />}
                  {row.startsUnread && <NewMessagesRule />}
                  <TranscriptRowContent row={row} requests={requests} />
                  {isLast && (
                    <div className="space-y-2 empty:hidden pt-4">
                      <AgentStatus agents={agents} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollableFade>
      {isReady && (
        <ScrollToBottomButton
          isAtBottom={virtualizer.isAtEnd()}
          onScrollToBottom={() => virtualizer.scrollToEnd({ behavior: "smooth" })}
        />
      )}
    </div>
  );
}

/** A user's message, one agent's run, or merged system messages. */
function TranscriptRowContent({
  row,
  requests,
}: {
  row: TranscriptRow;
  requests: ReadonlyMap<number, ChannelRequestState>;
}) {
  switch (row.type) {
    case "user":
      return <ChannelUserMessage message={row.messages[0]!} />;
    case "agent":
      return <AgentRun agentId={row.agentId} messages={row.messages} requests={requests} />;
    case "system":
      return <SystemMessageGroup messages={row.messages} />;
  }
}

function DayDivider({ date }: { date: string }) {
  return (
    <div className="mb-5 flex items-center gap-2">
      <span className="section-heading">{transcriptDayLabel(new Date(date), new Date())}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Marks where the messages that were unread when the reader arrived begin. */
function NewMessagesRule() {
  return (
    <div
      role="separator"
      aria-label="New messages"
      className="mb-5 flex items-center gap-2 text-2xs font-semibold text-unread"
    >
      <span className="h-px flex-1 bg-unread/50" />
      New
    </div>
  );
}
