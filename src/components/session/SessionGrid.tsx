import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { SessionView } from "./SessionView";
import { CanvasPane } from "./CanvasPane";
import { cn } from "@/lib/utils";
import type { ModelInfo, ModelConfiguration } from "@/types";
import type { SessionGridPane } from "@/hooks/session/sessionPanes";

// ============================================================================
// Session Grid - Multi-session grid layout (max 4 sessions)
// ============================================================================
// Renders 1-4 sessions in an adaptive grid layout:
// - 1 session: full screen
// - 2 sessions: horizontal split
// - 3 sessions: L-shape (2 top, 1 bottom full-width)
// - 4 sessions: 2×2 grid
//
// Features:
// - Maximize/minimize: Any cell can be temporarily expanded to full screen
// - Smooth animations: All transitions use 300ms CSS transitions
// - Drag resizing: Users can manually resize panels
// ============================================================================

export interface SessionGridProps {
  panes: SessionGridPane[]; // 1-4 session/canvas panes
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  onRemovePane: (pane: SessionGridPane) => void;
  models?: ModelInfo[];
  modelConfiguration?: ModelConfiguration | null;
  onModelConfigurationChange?: (configuration: ModelConfiguration) => void;
  draftSessionId?: string | null;
  onDraftSessionCreated?: (sessionId: string) => void;
}

type SessionGridSizes = {
  topRow: number;
  topLeft: number;
  topRight: number;
  bottomRow: number;
  bottomLeft: number;
  bottomRight: number;
};

function applySessionGridCountStep(
  prevCount: number,
  nextCount: number,
  sizes: SessionGridSizes,
): SessionGridSizes {
  const nextSizes = { ...sizes };

  if (nextCount > prevCount) {
    if (nextCount === 2) {
      nextSizes.topLeft = 50;
      nextSizes.topRight = 50;
    } else if (nextCount === 3) {
      nextSizes.topRow = 50;
      nextSizes.bottomRow = 50;
      nextSizes.bottomLeft = 100;
    } else if (nextCount === 4) {
      nextSizes.bottomLeft = 50;
      nextSizes.bottomRight = 50;
    }

    return nextSizes;
  }

  if (nextCount === 1) {
    nextSizes.topRow = 100;
    nextSizes.topLeft = 100;
    nextSizes.topRight = 0;
    nextSizes.bottomRow = 0;
  } else if (nextCount === 2) {
    nextSizes.topRow = 100;
    nextSizes.bottomRow = 0;
  } else if (nextCount === 3) {
    nextSizes.bottomLeft = 100;
    nextSizes.bottomRight = 0;
  }

  return nextSizes;
}

export function applySessionGridCountChange(
  prevCount: number,
  nextCount: number,
  sizes: SessionGridSizes,
): SessionGridSizes {
  if (nextCount === prevCount) {
    return sizes;
  }

  const direction = nextCount > prevCount ? 1 : -1;
  let nextSizes = { ...sizes };

  for (let currentCount = prevCount; currentCount !== nextCount; currentCount += direction) {
    nextSizes = applySessionGridCountStep(currentCount, currentCount + direction, nextSizes);
  }

  return nextSizes;
}

export function SessionGrid({
  panes,
  streamingSessionIds = [],
  unreadSessionIds,
  onRemovePane,
  models,
  modelConfiguration,
  onModelConfigurationChange,
  draftSessionId,
  onDraftSessionCreated,
}: SessionGridProps) {
  const count = panes.length;
  const [isDragging, setIsDragging] = useState(false);
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const savedSizesRef = useRef<SessionGridSizes | null>(null);
  const streamingSessionIdSet = useMemo(() => new Set(streamingSessionIds), [streamingSessionIds]);
  const unreadSessionIdSet = useMemo(() => new Set(unreadSessionIds), [unreadSessionIds]);

  // Calculate initial panel sizes based on session count at mount time
  const initialSizes = useMemo(() => {
    const c = panes.length;
    return {
      topRow: c >= 3 ? 50 : 100,
      topLeft: c >= 2 ? 50 : 100,
      topRight: c >= 2 ? 50 : 0,
      bottomRow: c >= 3 ? 50 : 0,
      bottomLeft: c >= 4 ? 50 : 100,
      bottomRight: c >= 4 ? 50 : 0,
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refs for imperative panel control
  const topRowRef = useRef<ImperativePanelHandle>(null);
  const topLeftRef = useRef<ImperativePanelHandle>(null);
  const topRightRef = useRef<ImperativePanelHandle>(null);
  const bottomRowRef = useRef<ImperativePanelHandle>(null);
  const bottomLeftRef = useRef<ImperativePanelHandle>(null);
  const bottomRightRef = useRef<ImperativePanelHandle>(null);
  const prevCountRef = useRef(count);

  // Transition class applied when not dragging
  const transitionClass = !isDragging ? "panel-transition" : "";

  const readCurrentSizes = useCallback((): SessionGridSizes => {
    return {
      topRow: topRowRef.current?.getSize() ?? initialSizes.topRow,
      topLeft: topLeftRef.current?.getSize() ?? initialSizes.topLeft,
      topRight: topRightRef.current?.getSize() ?? initialSizes.topRight,
      bottomRow: bottomRowRef.current?.getSize() ?? initialSizes.bottomRow,
      bottomLeft: bottomLeftRef.current?.getSize() ?? initialSizes.bottomLeft,
      bottomRight: bottomRightRef.current?.getSize() ?? initialSizes.bottomRight,
    };
  }, [initialSizes]);

  const resizePanels = useCallback((sizes: SessionGridSizes) => {
    topRowRef.current?.resize(sizes.topRow);
    topLeftRef.current?.resize(sizes.topLeft);
    topRightRef.current?.resize(sizes.topRight);
    bottomRowRef.current?.resize(sizes.bottomRow);
    bottomLeftRef.current?.resize(sizes.bottomLeft);
    bottomRightRef.current?.resize(sizes.bottomRight);
  }, []);

  // Handle maximize: save current sizes, then expand target cell
  const handleMaximize = useCallback(
    (paneId: string) => {
      savedSizesRef.current = readCurrentSizes();
      setMaximizedId(paneId);
    },
    [readCurrentSizes],
  );

  // Handle minimize: restore saved sizes
  const handleMinimize = useCallback(() => {
    const saved = savedSizesRef.current;
    if (saved) {
      resizePanels(saved);
      savedSizesRef.current = null;
    }
    setMaximizedId(null);
  }, [resizePanels]);

  // Exit maximize mode on manual resize
  const handleDragging = useCallback((dragging: boolean) => {
    setIsDragging(dragging);
    if (dragging) {
      setMaximizedId((currentMaximizedId) => {
        if (currentMaximizedId) {
          savedSizesRef.current = null;
        }
        return null;
      });
    }
  }, []);

  // Animate to maximized state
  useEffect(() => {
    if (!maximizedId) return;

    const maxIdx = panes.findIndex((pane) => pane.id === maximizedId);
    if (maxIdx === -1) {
      setMaximizedId(null);
      savedSizesRef.current = null;
      return;
    }

    const isTop = maxIdx < 2;
    const isLeft = maxIdx % 2 === 0;

    topRowRef.current?.resize(isTop ? 100 : 0);
    topLeftRef.current?.resize(isTop && isLeft ? 100 : 0);
    topRightRef.current?.resize(isTop && !isLeft ? 100 : 0);
    bottomRowRef.current?.resize(isTop ? 0 : 100);
    bottomLeftRef.current?.resize(!isTop && isLeft ? 100 : 0);
    bottomRightRef.current?.resize(!isTop && !isLeft ? 100 : 0);
  }, [maximizedId, panes]);

  // Handle session count changes
  useEffect(() => {
    const prevCount = prevCountRef.current;
    prevCountRef.current = count;

    if (count === prevCount) return;

    // Clear maximize when sessions change
    if (maximizedId) {
      savedSizesRef.current = null;
      setMaximizedId(null);
      return;
    }

    const nextSizes = applySessionGridCountChange(prevCount, count, readCurrentSizes());
    resizePanels(nextSizes);
  }, [count, maximizedId, readCurrentSizes, resizePanels]);

  const renderCell = useCallback(
    (index: number, showControls: boolean) => {
      const pane = panes[index];
      if (!pane) return null;

      const sessionId = pane.kind === "session" ? pane.sessionId : undefined;

      return (
        <GridCell
          key={pane.id}
          pane={pane}
          isSessionRunning={sessionId ? streamingSessionIdSet.has(sessionId) : false}
          isSessionUnread={sessionId ? unreadSessionIdSet.has(sessionId) : false}
          onRemove={onRemovePane}
          showControls={showControls}
          isMaximized={maximizedId === pane.id}
          onMaximize={handleMaximize}
          onMinimize={handleMinimize}
          models={models}
          modelConfiguration={modelConfiguration}
          onModelConfigurationChange={onModelConfigurationChange}
          draftSessionId={draftSessionId}
          onDraftSessionCreated={onDraftSessionCreated}
        />
      );
    },
    [
      draftSessionId,
      handleMaximize,
      handleMinimize,
      maximizedId,
      modelConfiguration,
      models,
      onDraftSessionCreated,
      onModelConfigurationChange,
      onRemovePane,
      panes,
      streamingSessionIdSet,
      unreadSessionIdSet,
    ],
  );

  return (
    <ResizablePanelGroup direction="vertical" className="h-full w-full">
      {/* Top Row */}
      <ResizablePanel
        ref={topRowRef}
        defaultSize={initialSizes.topRow}
        minSize={0}
        className={transitionClass}
      >
        <ResizablePanelGroup direction="horizontal">
          {/* Top-Left (Session 0) */}
          <ResizablePanel
            ref={topLeftRef}
            defaultSize={initialSizes.topLeft}
            minSize={0}
            className={transitionClass}
          >
            {renderCell(0, count > 1)}
          </ResizablePanel>

          <ResizableHandle onDragging={handleDragging} className={count < 2 ? "hidden" : ""} />

          {/* Top-Right (Session 1) */}
          <ResizablePanel
            ref={topRightRef}
            defaultSize={initialSizes.topRight}
            minSize={0}
            className={transitionClass}
          >
            {renderCell(1, true)}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      <ResizableHandle onDragging={handleDragging} className={count < 3 ? "hidden" : ""} />

      {/* Bottom Row */}
      <ResizablePanel
        ref={bottomRowRef}
        defaultSize={initialSizes.bottomRow}
        minSize={0}
        className={transitionClass}
      >
        <ResizablePanelGroup direction="horizontal">
          {/* Bottom-Left (Session 2) */}
          <ResizablePanel
            ref={bottomLeftRef}
            defaultSize={initialSizes.bottomLeft}
            minSize={0}
            className={transitionClass}
          >
            {renderCell(2, true)}
          </ResizablePanel>

          <ResizableHandle onDragging={handleDragging} className={count < 4 ? "hidden" : ""} />

          {/* Bottom-Right (Session 3) */}
          <ResizablePanel
            ref={bottomRightRef}
            defaultSize={initialSizes.bottomRight}
            minSize={0}
            className={transitionClass}
          >
            {renderCell(3, true)}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

// ============================================================================
// Grid Cell - Individual session container with hover controls
// ============================================================================

interface GridCellProps {
  pane: SessionGridPane;
  isSessionRunning: boolean;
  isSessionUnread: boolean;
  onRemove: (pane: SessionGridPane) => void;
  showControls: boolean;
  isMaximized: boolean;
  onMaximize: (paneId: string) => void;
  onMinimize: () => void;
  models?: ModelInfo[];
  modelConfiguration?: ModelConfiguration | null;
  onModelConfigurationChange?: (configuration: ModelConfiguration) => void;
  draftSessionId?: string | null;
  onDraftSessionCreated?: (sessionId: string) => void;
}

const GridCell = memo(function GridCell({
  pane,
  isSessionRunning,
  isSessionUnread,
  onRemove,
  showControls,
  isMaximized,
  onMaximize,
  onMinimize,
  models,
  modelConfiguration,
  onModelConfigurationChange,
  draftSessionId,
  onDraftSessionCreated,
}: GridCellProps) {
  const btnClass =
    "bg-background/90 backdrop-blur-sm hover:bg-background border border-border rounded-md p-1.5 shadow-sm hover:shadow-md";
  const iconClass = "h-4 w-4 text-muted-foreground hover:text-foreground";
  const isCloseable = pane.kind === "session" && !pane.isLinkedOnly;

  return (
    <div
      className={cn(
        "h-full w-full relative group bg-background transition-shadow",
        showControls && !isMaximized && "border-r border-b border-border",
      )}
    >
      {pane.kind === "session" && pane.isLinkedOnly && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 ring-2 ring-inset ring-sky-500/80"
        />
      )}

      {showControls && (
        <div className="absolute top-3 right-3 z-20 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {isMaximized ? (
            <button onClick={onMinimize} className={btnClass} aria-label="Minimize">
              <Minimize2 className={iconClass} />
            </button>
          ) : (
            <>
              <button
                onClick={() => onMaximize(pane.id)}
                className={btnClass}
                aria-label="Maximize"
              >
                <Maximize2 className={iconClass} />
              </button>
              {isCloseable && (
                <button onClick={() => onRemove(pane)} className={btnClass} aria-label="Remove">
                  <X className={iconClass} />
                </button>
              )}
            </>
          )}
        </div>
      )}

      {pane.kind === "session" ? (
        <SessionView
          sessionId={pane.sessionId}
          isSessionRunning={isSessionRunning}
          isSessionUnread={isSessionUnread}
          models={models}
          modelConfiguration={modelConfiguration}
          onModelConfigurationChange={onModelConfigurationChange}
          draftSessionId={draftSessionId}
          onDraftSessionCreated={onDraftSessionCreated}
        />
      ) : (
        <CanvasPane pane={pane} />
      )}
    </div>
  );
});
