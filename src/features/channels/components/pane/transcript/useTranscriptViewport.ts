import {
  // eslint-disable-next-line toy-box-react/no-manual-memoization -- TanStack Virtual treats key-extractor identity as measurement state.
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import type { ChannelConversationMessage } from "@channels/model";
import { messageRowIndex, type TranscriptRow } from "./transcriptRows";

/**
 * The transcript's virtualized viewport, and where the reader looks within it. It lands once,
 * hidden until positioned: on the first unread row when there is one, otherwise at the end.
 * Afterward it follows the end while the reader is there and after the reader's own post, reveals
 * a message on demand, loading older history first when needed, and loads older history
 * as the first row comes into view. A view that shows only some messages keeps loading until the
 * first row leaves view or history ends, even when that means fetching pages it shows nothing of.
 *
 * TanStack Virtual's instance is mutable, so the compiler skips this hook and it returns only values
 * that are current for the render.
 */
export function useTranscriptViewport({
  rows,
  unreadAfter,
  oldestSequence,
  loadPrevious,
}: {
  rows: readonly TranscriptRow[];
  /** Arrival read position; null means read, undefined awaits the connection's initial state. */
  unreadAfter: number | null | undefined;
  oldestSequence: number | undefined;
  loadPrevious: (throughSequence?: number) => Promise<void>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const getRowKey = useCallback((index: number) => rows[index]!.key, [rows]);
  // Agent runs are typically 3–5 messages, so each run is one virtual item.
  // If long runs become common, revisit row sizing and the first-row history trigger together.
  // eslint-disable-next-line react/incompatible-library -- TanStack Virtual intentionally owns its mutable instance.
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimatedRowHeight(rows[index]!),
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
  const followNextPostRef = useRef(false);
  const messageToShowRef = useRef<number | null>(null);
  const jumpedToUnreadRef = useRef(false);
  const [isReady, setIsReady] = useState(rows.length === 0);
  const rowCount = rows.length;
  const virtualItems = virtualizer.getVirtualItems();
  const firstVirtualIndex = virtualItems[0]?.index;
  // An empty view still has its first row ahead of it, in older history.
  const showsFirstRow = rowCount === 0 || firstVirtualIndex === 0;
  const firstUnreadIndex = rows.findIndex((row) => row.divider?.unread);

  // Landing starts at the end, positioned directly so no programmatic-scroll reconciliation can
  // outlive initialization.
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

    scrollElement.scrollTop = scrollElement.scrollHeight;
  }, [isReady, rowCount, virtualItems, virtualizer]);

  // With unread messages, landing finishes where they begin, once, before it paints.
  useLayoutEffect(() => {
    if (!isReady || unreadAfter === undefined || jumpedToUnreadRef.current) return;
    jumpedToUnreadRef.current = true;
    if (firstUnreadIndex >= 0) virtualizer.scrollToIndex(firstUnreadIndex, { align: "start" });
  }, [firstUnreadIndex, isReady, unreadAfter, virtualizer]);

  // The reader's own post always forms a new row.
  useLayoutEffect(() => {
    if (!followNextPostRef.current) return;
    followNextPostRef.current = false;
    virtualizer.scrollToEnd({ behavior: "smooth" });
  }, [rowCount, virtualizer]);

  // A message to show from older history appears once its page loads.
  useLayoutEffect(() => {
    const sequence = messageToShowRef.current;
    const index = sequence === null ? -1 : messageRowIndex(rows, sequence);
    if (index >= 0 && scrollRef.current) {
      messageToShowRef.current = null;
      scrollToMessage(scrollRef.current, virtualizer, sequence!, index);
    }
  }, [rows, virtualizer]);

  useEffect(() => {
    if (isReady && showsFirstRow && oldestSequence !== undefined && oldestSequence > 1) {
      void loadPrevious();
    }
  }, [showsFirstRow, isReady, oldestSequence, loadPrevious]);

  return {
    scrollRef,
    containerRef: virtualizer.containerRef,
    measureElement: virtualizer.measureElement,
    virtualItems,
    /** Landed, so the transcript can show. */
    isReady,
    isAtEnd: virtualizer.isAtEnd(),
    scrollToEnd: () => virtualizer.scrollToEnd({ behavior: "smooth" }),
    /** Follows the reader's next post to the end, even when they've scrolled away. */
    followNextPost: () => {
      followNextPostRef.current = true;
    },
    /** Reveals a user's or agent's message, loading older history through it first when needed. */
    showMessage: (sequence: number) => {
      const index = messageRowIndex(rows, sequence);
      if (index >= 0 && scrollRef.current) {
        scrollToMessage(scrollRef.current, virtualizer, sequence, index);
      } else {
        messageToShowRef.current = sequence;
        void loadPrevious(sequence);
      }
    },
  };
}

/** A row's height before it's measured: a message apiece, taller with attachments. */
function estimatedRowHeight(row: TranscriptRow): number {
  const messageHeight = ({ attachments }: ChannelConversationMessage) =>
    100 + (attachments?.length ? 96 : 0);
  switch (row.type) {
    case "user":
      return messageHeight(row.message);
    case "agent":
      return row.entries.reduce((height, { message }) => height + messageHeight(message), 0);
    case "system":
      return 20;
  }
}

/** Reveal a message within its row, bringing a virtualized row into view first. */
function scrollToMessage(
  root: HTMLElement,
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  sequence: number,
  index: number,
) {
  const element = root.querySelector(`[data-sequence="${sequence}"]`);
  if (element) {
    const top =
      root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top;
    // Keep the message's header below the transcript's top fade.
    virtualizer.scrollToOffset(top - 32, { behavior: "smooth" });
  } else {
    virtualizer.scrollToIndex(index, { align: "start", behavior: "smooth" });
  }
}
