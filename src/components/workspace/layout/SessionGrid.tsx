import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useAtom } from "jotai";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { useWorkspaceContext } from "@/hooks/workspace/context";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { useSetting } from "@/hooks/browser/useSetting";
import { WorkspacePaneView } from "../panes/WorkspacePaneView";
import { PANE_OVERLAY_BUTTON_CLASS, PANE_OVERLAY_ICON_CLASS } from "../panes/paneControls";
import { SessionOverlay, shouldShowSessionOverlay } from "../panes/session/SessionOverlay";
import { isAutomationRunSession } from "@/lib/automation/sessionId";
import { cn } from "@/lib/utils";
import type { SessionFeatureScope } from "@/lib/config/settings";
import type { ModelInfo, ModelConfiguration } from "@/types";
import {
  paneSourceSessionId,
  type ArtifactWorkspacePane,
  type ArtifactPaneMode,
  type WorkspacePane,
} from "@/lib/workspace/panes";

// ============================================================================
// Session Grid
// ============================================================================
// Renders 1-4 workspace panes in an adaptive grid layout:
// - 1 pane: full screen
// - 2 panes: horizontal split
// - 3 panes: L-shape (2 top, 1 bottom full-width)
// - 4 panes: 2×2 grid
//
// Features:
// - Maximize/minimize: The focused pane (focusedPaneAtom, shared with the
//   pager and written by auto-focus; see useWorkspaceFocus) is expanded to
//   full screen. This grid renders it and writes it back on user interaction.
// - Smooth animations: All transitions use 300ms CSS transitions
// - Drag resizing: Users can manually resize panels
// ============================================================================

export interface SessionGridProps {
  panes: WorkspacePane[];
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  onRemovePane: (pane: WorkspacePane) => void;
  onSetArtifactPaneMode?: (pane: ArtifactWorkspacePane, mode: ArtifactPaneMode) => void;
  models?: ModelInfo[];
  modelConfiguration?: ModelConfiguration | null;
  onModelConfigurationChange?: (configuration: ModelConfiguration) => void;
}

type SessionGridSizes = {
  topRow: number;
  topLeft: number;
  topRight: number;
  bottomRow: number;
  bottomLeft: number;
  bottomRight: number;
};

/** The canonical even-split layout for a pane count, before any user resizing. */
function defaultSessionGridSizes(count: number): SessionGridSizes {
  return {
    topRow: count >= 3 ? 50 : 100,
    topLeft: count >= 2 ? 50 : 100,
    topRight: count >= 2 ? 50 : 0,
    bottomRow: count >= 3 ? 50 : 0,
    bottomLeft: count >= 4 ? 50 : 100,
    bottomRight: count >= 4 ? 50 : 0,
  };
}

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
  onSetArtifactPaneMode,
  models,
  modelConfiguration,
  onModelConfigurationChange,
}: SessionGridProps) {
  const count = panes.length;
  const [isDragging, setIsDragging] = useState(false);
  const { focusedPaneAtom } = useWorkspaceContext();
  const [focusedPaneId, setFocusedPaneId] = useAtom(focusedPaneAtom);
  const savedSizesRef = useRef<SessionGridSizes | null>(null);
  const streamingSessionIdSet = useMemo(() => new Set(streamingSessionIds), [streamingSessionIds]);
  const unreadSessionIdSet = useMemo(() => new Set(unreadSessionIds), [unreadSessionIds]);
  const showSessionOverlay = useSetting("showSessionOverlay");

  // Calculate initial panel sizes based on pane count at mount time
  const initialSizes = useMemo(() => defaultSessionGridSizes(panes.length), []); // eslint-disable-line react-hooks/exhaustive-deps

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
  const isResizeLocked = focusedPaneId !== null;

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

  // Handle minimize: restore the pre-maximize layout.
  const handleMinimize = useCallback(() => {
    const saved = savedSizesRef.current;
    savedSizesRef.current = null;

    resizePanels(saved ?? defaultSessionGridSizes(panes.length));
    setFocusedPaneId(null);
  }, [setFocusedPaneId, panes.length, resizePanels]);

  useHotkey("Escape", handleMinimize, { enabled: focusedPaneId !== null });

  const renderResizeHandle = useCallback(
    (cellNumber: number) => (
      <ResizableHandle
        disabled={isResizeLocked}
        onDragging={setIsDragging}
        className={cn((count <= cellNumber || isResizeLocked) && "hidden")}
      />
    ),
    [count, isResizeLocked],
  );

  // Apply focus as a maximize. Focus can be written from anywhere, so the
  // pre-maximize layout is captured here, when a maximize is first applied —
  // a set savedSizesRef is therefore the signal that one is in effect.
  useEffect(() => {
    if (!focusedPaneId) return;

    const maxIdx = panes.findIndex((pane) => pane.id === focusedPaneId);
    if (maxIdx === -1) {
      // Focus points at a pane this grid doesn't render — a maximized pane
      // that departed, or a focus request for a pane outside the visible cap.
      // Clear it, restoring the layout only if a maximize was applied (the
      // remaining panels were resized to 0 to maximize it).
      const saved = savedSizesRef.current;
      savedSizesRef.current = null;
      setFocusedPaneId(null);
      if (saved) resizePanels(saved);
      return;
    }

    if (savedSizesRef.current === null) {
      savedSizesRef.current = readCurrentSizes();
    }

    const isTop = maxIdx < 2;
    const isLeft = maxIdx % 2 === 0;

    topRowRef.current?.resize(isTop ? 100 : 0);
    topLeftRef.current?.resize(isTop && isLeft ? 100 : 0);
    topRightRef.current?.resize(isTop && !isLeft ? 100 : 0);
    bottomRowRef.current?.resize(isTop ? 0 : 100);
    bottomLeftRef.current?.resize(!isTop && isLeft ? 100 : 0);
    bottomRightRef.current?.resize(!isTop && !isLeft ? 100 : 0);
  }, [focusedPaneId, setFocusedPaneId, panes, readCurrentSizes, resizePanels]);

  // Handle pane count changes
  useEffect(() => {
    const prevCount = prevCountRef.current;
    prevCountRef.current = count;

    if (count === prevCount) return;

    // Exit maximize when the pane count changes and restore the canonical
    // layout for the new count (panel sizes still reflect the maximize).
    if (focusedPaneId) {
      savedSizesRef.current = null;
      setFocusedPaneId(null);
      resizePanels(defaultSessionGridSizes(count));
      return;
    }

    const nextSizes = applySessionGridCountChange(prevCount, count, readCurrentSizes());
    resizePanels(nextSizes);
  }, [count, focusedPaneId, setFocusedPaneId, readCurrentSizes, resizePanels]);

  const renderCell = useCallback(
    (index: number, showControls: boolean) => {
      const pane = panes[index];
      if (!pane) return null;

      const sourceSessionId = paneSourceSessionId(pane);

      return (
        <PaneGridCell
          key={pane.id}
          pane={pane}
          isSourceSessionRunning={streamingSessionIdSet.has(sourceSessionId)}
          isSourceSessionUnread={unreadSessionIdSet.has(sourceSessionId)}
          onRemove={onRemovePane}
          showControls={showControls}
          isMaximized={focusedPaneId === pane.id}
          onFocusPane={setFocusedPaneId}
          onMinimize={handleMinimize}
          showSessionOverlay={showSessionOverlay}
          onSetArtifactPaneMode={onSetArtifactPaneMode}
          models={models}
          modelConfiguration={modelConfiguration}
          onModelConfigurationChange={onModelConfigurationChange}
        />
      );
    },
    [
      focusedPaneId,
      handleMinimize,
      modelConfiguration,
      models,
      onModelConfigurationChange,
      onRemovePane,
      onSetArtifactPaneMode,
      panes,
      setFocusedPaneId,
      showSessionOverlay,
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

          {renderResizeHandle(1)}

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

      {renderResizeHandle(2)}

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

          {renderResizeHandle(3)}

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
// Pane Grid Cell
// ============================================================================

interface PaneGridCellProps {
  pane: WorkspacePane;
  isSourceSessionRunning: boolean;
  isSourceSessionUnread: boolean;
  onRemove: (pane: WorkspacePane) => void;
  onSetArtifactPaneMode?: (pane: ArtifactWorkspacePane, mode: ArtifactPaneMode) => void;
  showControls: boolean;
  isMaximized: boolean;
  onFocusPane: (paneId: string) => void;
  onMinimize: () => void;
  showSessionOverlay: SessionFeatureScope;
  models?: ModelInfo[];
  modelConfiguration?: ModelConfiguration | null;
  onModelConfigurationChange?: (configuration: ModelConfiguration) => void;
}

const PaneGridCell = memo(function PaneGridCell({
  pane,
  isSourceSessionRunning,
  isSourceSessionUnread,
  onRemove,
  onSetArtifactPaneMode,
  showControls,
  isMaximized,
  onFocusPane,
  onMinimize,
  showSessionOverlay,
  models,
  modelConfiguration,
  onModelConfigurationChange,
}: PaneGridCellProps) {
  // The cell is a host: it hands its rendered pane the "normal" variant and this
  // slot (the hover-overlay controls), and the pane declares its own actions into
  // it — same contract as the pager, so the artifact's controls can't drift.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const btnClass = PANE_OVERLAY_BUTTON_CLASS;
  const iconClass = PANE_OVERLAY_ICON_CLASS;
  const showControlsPersistently = isMaximized;
  const isCloseable = pane.kind === "session" && !pane.isLinkedOnly;

  const associatedSessionId = paneSourceSessionId(pane);

  const shouldRenderSessionOverlay = shouldShowSessionOverlay({
    visibility: showSessionOverlay,
    sessionType: isAutomationRunSession(associatedSessionId) ? "automation" : "session",
    isDesktop: true,
    isMaximized,
    isSessionPane: pane.kind === "session",
  });

  const sessionProps = {
    isSessionRunning: isSourceSessionRunning,
    isSessionUnread: isSourceSessionUnread,
    models,
    modelConfiguration,
    onModelConfigurationChange,
  };

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
        <div
          className={cn(
            "absolute top-3 right-3 z-20 flex gap-1 transition-opacity duration-200",
            showControlsPersistently
              ? "opacity-100"
              : "opacity-0 delay-150 focus-within:opacity-100 focus-within:delay-0 group-hover:opacity-100 group-hover:delay-0 has-[[data-state=open]]:opacity-100 has-[[data-state=open]]:delay-0",
          )}
        >
          {/* The pane declares its own actions here (e.g. an artifact's saving
              indicator + mode menu), before the grid's own window controls. */}
          <div ref={setActionsSlot} className="contents" />
          {isMaximized ? (
            <button onClick={onMinimize} className={btnClass} aria-label="Minimize">
              <Minimize2 className={iconClass} />
            </button>
          ) : (
            <>
              <button
                onClick={() => onFocusPane(pane.id)}
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

      <WorkspacePaneView
        pane={pane}
        {...sessionProps}
        variant="normal"
        actionsSlot={actionsSlot}
        onSetArtifactPaneMode={onSetArtifactPaneMode}
      />

      {shouldRenderSessionOverlay && (
        <SessionOverlay sessionId={associatedSessionId} {...sessionProps} />
      )}
    </div>
  );
});
