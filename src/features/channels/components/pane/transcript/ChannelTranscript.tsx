import { useImperativeHandle, useState, type RefObject } from "react";
import { WorkingAgents } from "@channels/components/agents/WorkingAgents";
import type { ChannelMessage } from "@channels/model";
import { TranscriptSkeleton } from "@/shared/messages/TranscriptSkeleton";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { ScrollToBottomButton } from "@/shared/ui/scroll-to-bottom-button";
import { cn } from "@/shared/utils";
import { useChannelPane } from "../ChannelPaneContext";
import { AgentRun } from "./AgentRun";
import { ChannelPlaceholder } from "./ChannelPlaceholder";
import { ChannelUserMessage } from "./ChannelUserMessage";
import { SystemMessageGroup } from "./SystemMessageGroup";
import {
  transcriptDayLabel,
  transcriptRows,
  type TranscriptRow,
  type TranscriptView,
} from "./transcriptRows";
import { useTranscriptViewport } from "./useTranscriptViewport";

export type ChannelTranscriptHandle = {
  followNextPost: () => void;
  showMessage: (sequence: number) => void;
};

export function ChannelTranscript({
  messages,
  view,
  unreadAfter,
  handleRef,
  onLoadPrevious,
}: {
  messages: ChannelMessage[];
  view: TranscriptView;
  /** Arrival read position; null means read, undefined awaits the connection's initial state. */
  unreadAfter: number | null | undefined;
  handleRef: RefObject<ChannelTranscriptHandle | null>;
  onLoadPrevious: (throughSequence?: number) => Promise<void>;
}) {
  const { lead, members, bookmarks } = useChannelPane();
  const rows = transcriptRows(messages, { lead, members, bookmarks, unreadAfter, view });
  const {
    scrollRef,
    containerRef,
    measureElement,
    virtualItems,
    isReady,
    isAtEnd,
    scrollToEnd,
    followNextPost,
    showMessage,
  } = useTranscriptViewport({
    rows,
    unreadAfter,
    oldestSequence: messages[0]?.sequence,
    loadPrevious: onLoadPrevious,
  });
  useImperativeHandle(handleRef, () => ({ followNextPost, showMessage }));

  return (
    <div className="relative h-full bg-panel">
      {!isReady && <TranscriptSkeleton />}
      <ScrollableFade
        ref={scrollRef}
        axis="vertical"
        rootClassName={cn("size-full", !isReady && "invisible absolute inset-0")}
      >
        {rows.length === 0 ? (
          <div className="@container min-h-full px-4 py-5">
            <ChannelPlaceholder />
            <WorkingActivity />
          </div>
        ) : (
          <div ref={containerRef} className="@container relative min-h-full w-full">
            {virtualItems.map((virtualItem) => {
              const row = rows[virtualItem.index]!;
              return (
                <div
                  key={virtualItem.key}
                  ref={measureElement}
                  data-index={virtualItem.index}
                  className="absolute top-0 left-0 w-full px-4"
                >
                  {row.divider && <TranscriptDivider {...row.divider} />}
                  <TranscriptRowContent row={row} />
                  {/* Inside the last row, so the virtualizer measures it with the transcript. */}
                  {virtualItem.index === rows.length - 1 && <WorkingActivity />}
                </div>
              );
            })}
          </div>
        )}
      </ScrollableFade>
      {isReady && <ScrollToBottomButton isAtBottom={isAtEnd} onScrollToBottom={scrollToEnd} />}
    </div>
  );
}

/** A user's message, one agent's run, or merged system messages. */
function TranscriptRowContent({ row }: { row: TranscriptRow }) {
  switch (row.type) {
    case "user":
      return <ChannelUserMessage message={row.message} />;
    case "agent":
      return <AgentRun agentId={row.agentId} entries={row.entries} />;
    case "system":
      return <SystemMessageGroup messages={row.messages} />;
  }
}

/**
 * Marks where a day, the messages that were unread when the reader arrived, or both begin. When
 * both begin at once, one divider labels the day and marks it new rather than stacking two rules.
 */
function TranscriptDivider({ day, unread }: NonNullable<TranscriptRow["divider"]>) {
  const [now] = useState(() => new Date());

  return (
    <div className="mb-5 flex items-center gap-2">
      {day && <span className="section-heading">{transcriptDayLabel(day, now)}</span>}
      <span
        role={unread ? "separator" : undefined}
        aria-label={unread ? "New messages" : undefined}
        className={cn("h-px flex-1", unread ? "bg-unread/50" : "bg-border")}
      />
      {unread && (
        <span aria-hidden className="text-2xs font-semibold text-unread">
          New
        </span>
      )}
    </div>
  );
}

/** The agents working now, after the latest message. */
function WorkingActivity() {
  const { agents, presence } = useChannelPane();
  const working = agents.flatMap((agent) => {
    const activity = presence[agent.id];
    return activity?.state === "working" ? [{ agent, text: activity.text }] : [];
  });
  return (
    <div className="pt-4 empty:hidden">
      <WorkingAgents working={working} />
    </div>
  );
}
