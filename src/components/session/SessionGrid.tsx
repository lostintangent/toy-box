import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import { useAtom } from "jotai";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { focusedPaneAtom } from "@/atoms";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { useSetting } from "@/hooks/browser/useSetting";
import { useViewport } from "@/hooks/browser/ViewportContext";
import { SessionPane } from "./panes/session/SessionPane";
import { CanvasPane } from "./panes/CanvasPane";
import { ArtifactPane } from "./panes/ArtifactPane";
import { ArtifactModeMenu } from "./panes/chrome/ArtifactModeMenu";
import { ArtifactSavingIndicator } from "./panes/chrome/ArtifactSavingIndicator";
import {
  PANE_OVERLAY_BUTTON_CLASS,
  PANE_OVERLAY_ICON_CLASS,
  SessionOverlay,
  shouldShowSessionOverlay,
} from "./panes/session/SessionOverlay";
import { isAutomationRunSession } from "@/lib/automation/sessionId";
import { cn } from "@/lib/utils";
import type { SessionFeatureScope } from "@/lib/config/settings";
import type { ModelInfo, ModelConfiguration } from "@/types";
import {
  isArtifactPane,
  type ArtifactGridPane,
  type ArtifactPaneMode,
  type SessionGridPane,
} from "@/hooks/session/sessionPanes";

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
// - Maximize/minimize: The focused pane (focusedPaneAtom, shared with the
//   mobile pager and written by auto-focus; see usePaneFocus) is expanded to
//   full screen. This grid renders it and writes it back on user interaction.
// - Smooth animations: All transitions use 300ms CSS transitions
// - Drag resizing: Users can manually resize panels
// ============================================================================

export interface SessionGridProps {
  panes: SessionGridPane[]; // 1-4 session/canvas/artifact panes
  streamingSessionIds: string[];
  unreadSessionIds: string[];
  onRemovePane: (pane: SessionGridPane) => void;
  onSetArtifactPaneMode?: (pane: ArtifactGridPane, mode: ArtifactPaneMode) => void;
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
  draftSessionId,
  onDraftSessionCreated,
}: SessionGridProps) {
  const count = panes.length;
  const [isDragging, setIsDragging] = useState(false);
  const [focusedPaneId, setFocusedPaneId] = useAtom(focusedPaneAtom);
  const savedSizesRef = useRef<SessionGridSizes | null>(null);
  const streamingSessionIdSet = useMemo(() => new Set(streamingSessionIds), [streamingSessionIds]);
  const unreadSessionIdSet = useMemo(() => new Set(unreadSessionIds), [unreadSessionIds]);
  const showSessionOverlay = useSetting("showSessionOverlay");
  const { isDesktop } = useViewport();

  // Calculate initial panel sizes based on session count at mount time
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

  // Maximize is just focusing a pane. Every entry path — this button, an
  // artifact pill, artifact auto-focus — writes the atom, and the effect
  // below applies it (capturing the pre-maximize layout at that point).
  const handleMaximize = useCallback(
    (paneId: string) => {
      setFocusedPaneId(paneId);
    },
    [setFocusedPaneId],
  );

  // Handle minimize: restore the pre-maximize layout.
  const handleMinimize = useCallback(() => {
    const saved = savedSizesRef.current;
    savedSizesRef.current = null;
    resizePanels(saved ?? defaultSessionGridSizes(panes.length));
    setFocusedPaneId(null);
  }, [setFocusedPaneId, panes.length, resizePanels]);

  // Exit maximize mode on manual resize; the user is taking over the layout,
  // so the saved restore point no longer applies.
  const handleDragging = useCallback(
    (dragging: boolean) => {
      setIsDragging(dragging);
      if (dragging && focusedPaneId) {
        savedSizesRef.current = null;
        setFocusedPaneId(null);
      }
    },
    [focusedPaneId, setFocusedPaneId],
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

  // Handle session count changes
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

      const sourceSessionId = pane.kind === "session" ? pane.sessionId : pane.sourceSessionId;

      return (
        <GridCell
          key={pane.id}
          pane={pane}
          isSourceSessionRunning={streamingSessionIdSet.has(sourceSessionId)}
          isSourceSessionUnread={unreadSessionIdSet.has(sourceSessionId)}
          onRemove={onRemovePane}
          showControls={showControls}
          isMaximized={focusedPaneId === pane.id}
          onMaximize={handleMaximize}
          onMinimize={handleMinimize}
          isDesktop={isDesktop}
          showSessionOverlay={showSessionOverlay}
          onSetArtifactPaneMode={onSetArtifactPaneMode}
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
      focusedPaneId,
      handleMaximize,
      handleMinimize,
      isDesktop,
      modelConfiguration,
      models,
      onDraftSessionCreated,
      onModelConfigurationChange,
      onRemovePane,
      onSetArtifactPaneMode,
      panes,
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
  isSourceSessionRunning: boolean;
  isSourceSessionUnread: boolean;
  onRemove: (pane: SessionGridPane) => void;
  onSetArtifactPaneMode?: (pane: ArtifactGridPane, mode: ArtifactPaneMode) => void;
  showControls: boolean;
  isMaximized: boolean;
  onMaximize: (paneId: string) => void;
  onMinimize: () => void;
  isDesktop: boolean;
  showSessionOverlay: SessionFeatureScope;
  models?: ModelInfo[];
  modelConfiguration?: ModelConfiguration | null;
  onModelConfigurationChange?: (configuration: ModelConfiguration) => void;
  draftSessionId?: string | null;
  onDraftSessionCreated?: (sessionId: string) => void;
}

const GridCell = memo(function GridCell({
  pane,
  isSourceSessionRunning,
  isSourceSessionUnread,
  onRemove,
  onSetArtifactPaneMode,
  showControls,
  isMaximized,
  onMaximize,
  onMinimize,
  isDesktop,
  showSessionOverlay,
  models,
  modelConfiguration,
  onModelConfigurationChange,
  draftSessionId,
  onDraftSessionCreated,
}: GridCellProps) {
  const [isArtifactSaving, setIsArtifactSaving] = useState(false);
  const btnClass = PANE_OVERLAY_BUTTON_CLASS;
  const iconClass = PANE_OVERLAY_ICON_CLASS;
  const showControlsPersistently = isDesktop && isMaximized;
  const isCloseable = pane.kind === "session" && !pane.isLinkedOnly;
  const artifactPane = isArtifactPane(pane) ? pane : undefined;

  const associatedSessionId = pane.kind === "session" ? pane.sessionId : pane.sourceSessionId;

  const shouldRenderSessionOverlay = shouldShowSessionOverlay({
    visibility: showSessionOverlay,
    sessionType: isAutomationRunSession(associatedSessionId) ? "automation" : "session",
    isDesktop,
    isMaximized,
    isSessionPane: pane.kind === "session",
  });

  const sessionProps = {
    sessionId: associatedSessionId,
    isSessionRunning: isSourceSessionRunning,
    isSessionUnread: isSourceSessionUnread,
    models,
    modelConfiguration,
    onModelConfigurationChange,
  };

  const savingIndicator = artifactPane ? (
    <ArtifactSavingIndicator isSaving={isArtifactSaving} />
  ) : null;
  const modeMenu =
    artifactPane && onSetArtifactPaneMode ? (
      <ArtifactModeMenu
        mode={artifactPane.mode}
        onModeChange={(mode) => onSetArtifactPaneMode(artifactPane, mode)}
        className={btnClass}
        iconClassName={iconClass}
        showLabel={false}
      />
    ) : null;

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
          {isMaximized ? (
            <>
              {savingIndicator}
              {modeMenu}
              <button onClick={onMinimize} className={btnClass} aria-label="Minimize">
                <Minimize2 className={iconClass} />
              </button>
            </>
          ) : (
            <>
              {savingIndicator}
              {modeMenu}
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
        <SessionPane
          {...sessionProps}
          draftSessionId={draftSessionId}
          onDraftSessionCreated={onDraftSessionCreated}
        />
      ) : pane.kind === "canvas" ? (
        <CanvasPane pane={pane} />
      ) : (
        <ArtifactPane pane={pane} onSavingChange={setIsArtifactSaving} />
      )}

      {shouldRenderSessionOverlay && <SessionOverlay {...sessionProps} />}
    </div>
  );
});
