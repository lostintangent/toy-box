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
import { isChannelSystemMessage } from "@channels/model";
import type { ChannelMember, ChannelMessage } from "@channels/model";
import { TranscriptSkeleton } from "@sessions/components/transcript/TranscriptSkeleton";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import { ScrollToBottomButton } from "@/shared/components/ui/scroll-to-bottom-button";
import { cn } from "@/shared/utils";
import { ChannelMessageView } from "./ChannelMessage";
import { ChannelPlaceholder } from "./ChannelPlaceholder";

export function ChannelTranscript({
  messages,
  members,
  scrollToBottomRef,
  onLoadPrevious,
}: {
  messages: ChannelMessage[];
  members: ChannelMember[];
  scrollToBottomRef: RefObject<(() => void) | null>;
  onLoadPrevious: () => Promise<void>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAfterAppendRef = useRef(false);
  const [isReady, setIsReady] = useState(messages.length === 0);
  const messageGroups = groupAdjacentSystemMessages(messages);
  const messageGroupCount = messageGroups.length;
  const getMessageKey = useCallback(
    (index: number) => messageGroups[index]!.at(-1)!.id,
    [messageGroups],
  );
  // eslint-disable-next-line react/react-compiler -- TanStack Virtual intentionally owns its mutable instance.
  const virtualizer = useVirtualizer({
    count: messageGroupCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const message = messageGroups[index]![0]!;
      if (isChannelSystemMessage(message)) return 20;
      return 100 + (message.attachments?.length ? 56 : 0);
    },
    getItemKey: getMessageKey,
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
      virtualItems.at(-1)?.index === messageGroupCount - 1 &&
      virtualizer.isAtEnd() &&
      !virtualizer.isScrolling
    ) {
      setIsReady(true);
      return;
    }

    // Position directly so no programmatic-scroll reconciliation can outlive initialization.
    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [isReady, messageGroupCount, virtualItems, virtualizer]);

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
              <AgentStatus members={members} />
            </div>
          </div>
        ) : (
          <div ref={virtualizer.containerRef} className="@container relative min-h-full w-full">
            {virtualItems.map((virtualItem) => {
              const messageGroup = messageGroups[virtualItem.index]!;
              const isLast = virtualItem.index === messageGroups.length - 1;
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  className="absolute top-0 left-0 w-full px-4"
                >
                  <ChannelMessageView messages={messageGroup} members={members} />
                  {isLast && (
                    <div className="space-y-2 empty:hidden pt-4">
                      <AgentStatus members={members} />
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

function groupAdjacentSystemMessages(messages: readonly ChannelMessage[]): ChannelMessage[][] {
  const groups: ChannelMessage[][] = [];
  for (const message of messages) {
    const previous = groups.at(-1);
    const key = systemMessageGroupKey(message);
    if (key && previous && systemMessageGroupKey(previous[0]!) === key) {
      previous.push(message);
    } else {
      groups.push([message]);
    }
  }
  return groups;
}

function systemMessageGroupKey(message: ChannelMessage) {
  if (!isChannelSystemMessage(message)) return undefined;
  const content = message.content;
  if (content.type === "member_joined" || content.type === "member_left") return content.type;
  if (content.type === "artifact_shared" && content.actor.type === "agent") {
    return `${content.type}:${content.actor.agentId}`;
  }
  return undefined;
}
