import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { SessionView } from "./SessionView";
import { cn } from "@/lib/utils";
import type { ModelInfo } from "@/types";

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
  sessionIds: string[]; // 1-4 session IDs
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  onRemoveSession: (sessionId: string) => void;
  models?: ModelInfo[];
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  draftSessionId?: string | null;
  onDraftSessionCreated?: (sessionId: string) => void;
}

export function SessionGrid({
  sessionIds,
  streamingSessionIds = [],
  unreadSessionIds,
  onRemoveSession,
  models,
  selectedModel,
  onModelChange,
  draftSessionId,
  onDraftSessionCreated,
}: SessionGridProps) {
  const count = sessionIds.length;
  const [isDragging, setIsDragging] = useState(false);
  const [maximizedId, setMaximizedId] = useState<string | null>(null);
  const savedSizesRef = useRef<Record<string, number> | null>(null);

  // Props forwarded to every GridCell (not grid-position-specific)
  const sessionProps = {
    models,
    selectedModel,
    onModelChange,
    draftSessionId,
    onDraftSessionCreated,
  };

  // Calculate initial panel sizes based on session count at mount time
  const initialSizes = useMemo(() => {
    const c = sessionIds.length;
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

  // Handle maximize: save current sizes, then expand target cell
  const handleMaximize = useCallback((sessionId: string) => {
    savedSizesRef.current = {
      topRow: topRowRef.current?.getSize() ?? 50,
      topLeft: topLeftRef.current?.getSize() ?? 50,
      topRight: topRightRef.current?.getSize() ?? 50,
      bottomRow: bottomRowRef.current?.getSize() ?? 50,
      bottomLeft: bottomLeftRef.current?.getSize() ?? 50,
      bottomRight: bottomRightRef.current?.getSize() ?? 50,
    };
    setMaximizedId(sessionId);
  }, []);

  // Handle minimize: restore saved sizes
  const handleMinimize = useCallback(() => {
    const saved = savedSizesRef.current;
    if (saved) {
      topRowRef.current?.resize(saved.topRow);
      topLeftRef.current?.resize(saved.topLeft);
      topRightRef.current?.resize(saved.topRight);
      bottomRowRef.current?.resize(saved.bottomRow);
      bottomLeftRef.current?.resize(saved.bottomLeft);
      bottomRightRef.current?.resize(saved.bottomRight);
      savedSizesRef.current = null;
    }
    setMaximizedId(null);
  }, []);

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

    const maxIdx = sessionIds.indexOf(maximizedId);
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
  }, [maximizedId, sessionIds]);

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

    // Adding sessions
    if (count > prevCount) {
      if (count === 2) {
        topLeftRef.current?.resize(50);
        topRightRef.current?.resize(50);
      } else if (count === 3) {
        topRowRef.current?.resize(50);
        bottomRowRef.current?.resize(50);
        bottomLeftRef.current?.resize(100);
      } else if (count === 4) {
        bottomLeftRef.current?.resize(50);
        bottomRightRef.current?.resize(50);
      }
      return;
    }

    // Removing sessions
    if (count === 1) {
      topRowRef.current?.resize(100);
      topLeftRef.current?.resize(100);
      topRightRef.current?.resize(0);
      bottomRowRef.current?.resize(0);
    } else if (count === 2) {
      topRowRef.current?.resize(100);
      bottomRowRef.current?.resize(0);
    } else if (count === 3) {
      bottomLeftRef.current?.resize(100);
      bottomRightRef.current?.resize(0);
    }
  }, [count, maximizedId]);

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
            {sessionIds[0] && (
              <GridCell
                key={sessionIds[0]}
                sessionId={sessionIds[0]}
                isSessionRunning={streamingSessionIds.includes(sessionIds[0])}
                isSessionUnread={unreadSessionIds.includes(sessionIds[0]) ?? false}
                onRemove={onRemoveSession}
                showControls={count > 1}
                isMaximized={maximizedId === sessionIds[0]}
                onMaximize={handleMaximize}
                onMinimize={handleMinimize}
                {...sessionProps}
              />
            )}
          </ResizablePanel>

          <ResizableHandle onDragging={handleDragging} className={count < 2 ? "hidden" : ""} />

          {/* Top-Right (Session 1) */}
          <ResizablePanel
            ref={topRightRef}
            defaultSize={initialSizes.topRight}
            minSize={0}
            className={transitionClass}
          >
            {sessionIds[1] && (
              <GridCell
                key={sessionIds[1]}
                sessionId={sessionIds[1]}
                isSessionRunning={streamingSessionIds.includes(sessionIds[1])}
                isSessionUnread={unreadSessionIds.includes(sessionIds[1]) ?? false}
                onRemove={onRemoveSession}
                showControls={true}
                isMaximized={maximizedId === sessionIds[1]}
                onMaximize={handleMaximize}
                onMinimize={handleMinimize}
                {...sessionProps}
              />
            )}
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
            {sessionIds[2] && (
              <GridCell
                key={sessionIds[2]}
                sessionId={sessionIds[2]}
                isSessionRunning={streamingSessionIds.includes(sessionIds[2])}
                isSessionUnread={unreadSessionIds.includes(sessionIds[2]) ?? false}
                onRemove={onRemoveSession}
                showControls={true}
                isMaximized={maximizedId === sessionIds[2]}
                onMaximize={handleMaximize}
                onMinimize={handleMinimize}
                {...sessionProps}
              />
            )}
          </ResizablePanel>

          <ResizableHandle onDragging={handleDragging} className={count < 4 ? "hidden" : ""} />

          {/* Bottom-Right (Session 3) */}
          <ResizablePanel
            ref={bottomRightRef}
            defaultSize={initialSizes.bottomRight}
            minSize={0}
            className={transitionClass}
          >
            {sessionIds[3] && (
              <GridCell
                key={sessionIds[3]}
                sessionId={sessionIds[3]}
                isSessionRunning={streamingSessionIds.includes(sessionIds[3])}
                isSessionUnread={unreadSessionIds.includes(sessionIds[3]) ?? false}
                onRemove={onRemoveSession}
                showControls={true}
                isMaximized={maximizedId === sessionIds[3]}
                onMaximize={handleMaximize}
                onMinimize={handleMinimize}
                {...sessionProps}
              />
            )}
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
  sessionId: string;
  isSessionRunning: boolean;
  isSessionUnread: boolean;
  onRemove: (sessionId: string) => void;
  showControls: boolean;
  isMaximized: boolean;
  onMaximize: (sessionId: string) => void;
  onMinimize: () => void;
  models?: ModelInfo[];
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  draftSessionId?: string | null;
  onDraftSessionCreated?: (sessionId: string) => void;
}

const GridCell = memo(function GridCell({
  sessionId,
  isSessionRunning,
  isSessionUnread,
  onRemove,
  showControls,
  isMaximized,
  onMaximize,
  onMinimize,
  models,
  selectedModel,
  onModelChange,
  draftSessionId,
  onDraftSessionCreated,
}: GridCellProps) {
  const btnClass =
    "bg-background/90 backdrop-blur-sm hover:bg-background border border-border rounded-md p-1.5 shadow-sm hover:shadow-md";
  const iconClass = "h-4 w-4 text-muted-foreground hover:text-foreground";

  return (
    <div
      className={cn(
        "h-full w-full relative group bg-background",
        showControls && !isMaximized && "border-r border-b border-border",
      )}
    >
      {showControls && (
        <div className="absolute top-3 right-3 z-20 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {isMaximized ? (
            <button onClick={onMinimize} className={btnClass} aria-label="Minimize">
              <Minimize2 className={iconClass} />
            </button>
          ) : (
            <>
              <button
                onClick={() => onMaximize(sessionId)}
                className={btnClass}
                aria-label="Maximize"
              >
                <Maximize2 className={iconClass} />
              </button>
              <button onClick={() => onRemove(sessionId)} className={btnClass} aria-label="Remove">
                <X className={iconClass} />
              </button>
            </>
          )}
        </div>
      )}

      <SessionView
        sessionId={sessionId}
        isSessionRunning={isSessionRunning}
        isSessionUnread={isSessionUnread}
        models={models}
        selectedModel={selectedModel}
        onModelChange={onModelChange}
        draftSessionId={draftSessionId}
        onDraftSessionCreated={onDraftSessionCreated}
      />
    </div>
  );
});
