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
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
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
import {
  pendingRequestRow,
  transcriptDayLabel,
  transcriptRows,
  type TranscriptRow,
} from "./transcriptRows";

export type ChannelTranscriptHandle = { scrollToBottom: () => void; showRequest: () => void };

export function ChannelTranscript({
  messages,
  unreadAfter,
  handleRef,
  requestSequence,
  onLoadPrevious,
}: {
  messages: ChannelMessage[];
  /** Arrival read position; null means read, undefined awaits the connection's initial state. */
  unreadAfter: number | null | undefined;
  handleRef: RefObject<ChannelTranscriptHandle | null>;
  requestSequence: number | null;
  onLoadPrevious: (throughSequence?: number) => Promise<void>;
}) {
  const { agents, presence } = useChannelPane();
  const working = agents.flatMap((agent) => {
    const activity = presence[agent.id];
    return activity?.state === "working" ? [{ agent, status: activity.text }] : [];
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAfterAppendRef = useRef(false);
  const requestToShowRef = useRef<number | null>(null);
  const jumpedToUnreadRef = useRef(false);
  const [isReady, setIsReady] = useState(messages.length === 0);
  const requests = channelRequestStates(messages);
  const rows = transcriptRows(messages, unreadAfter ?? undefined);
  const rowCount = rows.length;
  const firstUnreadIndex = rows.findIndex((row) => row.startsUnread);
  // A row keeps its first message's identity as later messages join its run.
  const getRowKey = useCallback((index: number) => rows[index]!.messages[0]!.id, [rows]);
  // Agent runs are typically 3–5 messages, so each run is one virtual item.
  // If long runs become common, revisit row sizing and the first-row history trigger together.
  // eslint-disable-next-line react/incompatible-library -- TanStack Virtual intentionally owns its mutable instance.
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

  const request = pendingRequestRow(rows, requestSequence);
  useImperativeHandle(handleRef, () => ({
    scrollToBottom: () => {
      scrollAfterAppendRef.current = true;
    },
    showRequest: () => {
      if (request && scrollRef.current) scrollToRequest(scrollRef.current, virtualizer, request);
      else if (requestSequence !== null) {
        requestToShowRef.current = requestSequence;
        void onLoadPrevious(requestSequence);
      }
    },
  }));
  useLayoutEffect(() => {
    if (request && request.sequence === requestToShowRef.current && scrollRef.current) {
      requestToShowRef.current = null;
      scrollToRequest(scrollRef.current, virtualizer, request);
    }
  }, [request, virtualizer]);
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
    if (!isReady || unreadAfter === undefined || jumpedToUnreadRef.current) return;
    jumpedToUnreadRef.current = true;
    if (firstUnreadIndex >= 0) virtualizer.scrollToIndex(firstUnreadIndex, { align: "start" });
  }, [firstUnreadIndex, isReady, unreadAfter, virtualizer]);

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
              <AgentStatus working={working} />
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
                      <AgentStatus working={working} />
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

/** Reveal the question within its agent run, bringing a virtualized row into view first. */
function scrollToRequest(
  root: HTMLElement,
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  request: { sequence: number; index: number },
) {
  const element = root.querySelector(`[data-request-sequence="${request.sequence}"]`);
  if (element) {
    const top =
      root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top;
    // Keep the question header below the transcript's top fade.
    virtualizer.scrollToOffset(top - 32, { behavior: "smooth" });
  } else {
    virtualizer.scrollToIndex(request.index, { align: "start", behavior: "smooth" });
  }
}
