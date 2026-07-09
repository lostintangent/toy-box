import { useEffect, useRef, useState, type RefObject } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useAtom } from "jotai";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { useFocusedPaneAtom } from "@/hooks/workspace/layout/focus";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { WorkspacePaneView } from "../panes/WorkspacePaneView";
import { PANE_OVERLAY_BUTTON_CLASS, PANE_OVERLAY_ICON_CLASS } from "../panes/paneControls";
import { SessionOverlay } from "../panes/session/SessionOverlay";
import { cn } from "@/lib/utils";
import { paneSourceSessionId, type WorkspacePane } from "@/lib/workspace/panes";

/** Resizable desktop host for up to four workspace panes. Pane count determines
 *  the grid shape; user resizing is preserved across incremental changes, and
 *  the shared focus value drives maximize and restore. */
export interface WorkspaceGridProps {
  panes: WorkspacePane[];
  onCloseSession: (sessionId: string) => void;
}

type WorkspaceGridLayout = {
  rows: [top: number, bottom: number];
  top: [left: number, right: number];
  bottom: [left: number, right: number];
};

/** The canonical even-split layout for a pane count, before any user resizing. */
function defaultWorkspaceGridLayout(count: number): WorkspaceGridLayout {
  return {
    rows: count >= 3 ? [50, 50] : [100, 0],
    top: count >= 2 ? [50, 50] : [100, 0],
    bottom: count >= 4 ? [50, 50] : [100, 0],
  };
}

function applyWorkspaceGridCountStep(
  prevCount: number,
  nextCount: number,
  layout: WorkspaceGridLayout,
): WorkspaceGridLayout {
  if (nextCount > prevCount) {
    if (nextCount === 2) {
      return { ...layout, top: [50, 50] };
    }
    if (nextCount === 3) {
      return { ...layout, rows: [50, 50], bottom: [100, 0] };
    }
    if (nextCount === 4) {
      return { ...layout, bottom: [50, 50] };
    }
  }

  if (nextCount === 1) {
    return { ...layout, rows: [100, 0], top: [100, 0] };
  }
  if (nextCount === 2) {
    return { ...layout, rows: [100, 0] };
  }
  if (nextCount === 3) {
    return { ...layout, bottom: [100, 0] };
  }

  return layout;
}

export function applyWorkspaceGridCountChange(
  prevCount: number,
  nextCount: number,
  layout: WorkspaceGridLayout,
): WorkspaceGridLayout {
  if (nextCount === prevCount) {
    return layout;
  }

  const direction = nextCount > prevCount ? 1 : -1;
  let nextLayout = layout;

  for (let currentCount = prevCount; currentCount !== nextCount; currentCount += direction) {
    nextLayout = applyWorkspaceGridCountStep(currentCount, currentCount + direction, nextLayout);
  }

  return nextLayout;
}

type PanelGroupRef = RefObject<ImperativePanelGroupHandle | null>;

function readPanelGroupLayout(
  groupRef: PanelGroupRef,
  fallback: [number, number],
): [number, number] {
  const [first = fallback[0], second = fallback[1]] = groupRef.current?.getLayout() ?? fallback;
  return [first, second];
}

function readWorkspaceGridLayout(
  rowGroupRef: PanelGroupRef,
  topGroupRef: PanelGroupRef,
  bottomGroupRef: PanelGroupRef,
  fallback: WorkspaceGridLayout,
): WorkspaceGridLayout {
  return {
    rows: readPanelGroupLayout(rowGroupRef, fallback.rows),
    top: readPanelGroupLayout(topGroupRef, fallback.top),
    bottom: readPanelGroupLayout(bottomGroupRef, fallback.bottom),
  };
}

function applyWorkspaceGridLayout(
  rowGroupRef: PanelGroupRef,
  topGroupRef: PanelGroupRef,
  bottomGroupRef: PanelGroupRef,
  layout: WorkspaceGridLayout,
) {
  topGroupRef.current?.setLayout(layout.top);
  bottomGroupRef.current?.setLayout(layout.bottom);
  rowGroupRef.current?.setLayout(layout.rows);
}

export function WorkspaceGrid({ panes, onCloseSession }: WorkspaceGridProps) {
  const count = panes.length;
  const [isDragging, setIsDragging] = useState(false);
  const [focusedPaneId, setFocusedPaneId] = useAtom(useFocusedPaneAtom());

  // Group defaults are fixed at mount; later count changes apply a complete layout.
  const [initialLayout] = useState(() => defaultWorkspaceGridLayout(panes.length));

  const rowGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const topGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const bottomGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const savedLayoutRef = useRef<WorkspaceGridLayout | null>(null);
  const prevCountRef = useRef(count);

  const transitionClass = !isDragging ? "panel-transition" : "";
  const isResizeLocked = focusedPaneId !== null;

  function handleMinimize() {
    const saved = savedLayoutRef.current;
    savedLayoutRef.current = null;

    applyWorkspaceGridLayout(
      rowGroupRef,
      topGroupRef,
      bottomGroupRef,
      saved ?? defaultWorkspaceGridLayout(panes.length),
    );
    setFocusedPaneId(null);
  }

  useHotkey("Escape", handleMinimize, { enabled: focusedPaneId !== null });

  function renderResizeHandle(cellNumber: number) {
    return (
      <ResizableHandle
        disabled={isResizeLocked}
        onDragging={setIsDragging}
        className={cn((count <= cellNumber || isResizeLocked) && "hidden")}
      />
    );
  }

  // Apply focus as a maximize. Focus can be written from anywhere, so the
  // pre-maximize layout is captured here, when a maximize is first applied —
  // a saved layout is therefore the signal that one is in effect.
  useEffect(() => {
    if (!focusedPaneId) return;

    const maxIdx = panes.findIndex((pane) => pane.id === focusedPaneId);
    if (maxIdx === -1) {
      // Focus points at a pane this grid doesn't render — a maximized pane
      // that departed, or a focus request for a pane outside the visible cap.
      // Clear it, restoring the layout only if a maximize was applied (the
      // remaining panels were resized to 0 to maximize it).
      const saved = savedLayoutRef.current;
      savedLayoutRef.current = null;
      setFocusedPaneId(null);
      if (saved) {
        applyWorkspaceGridLayout(rowGroupRef, topGroupRef, bottomGroupRef, saved);
      }
      return;
    }

    if (savedLayoutRef.current === null) {
      savedLayoutRef.current = readWorkspaceGridLayout(
        rowGroupRef,
        topGroupRef,
        bottomGroupRef,
        initialLayout,
      );
    }

    const isTop = maxIdx < 2;
    const isLeft = maxIdx % 2 === 0;

    (isTop ? topGroupRef : bottomGroupRef).current?.setLayout(isLeft ? [100, 0] : [0, 100]);
    rowGroupRef.current?.setLayout(isTop ? [100, 0] : [0, 100]);
  }, [focusedPaneId, initialLayout, panes, setFocusedPaneId]);

  useEffect(() => {
    const prevCount = prevCountRef.current;
    prevCountRef.current = count;

    if (count === prevCount) return;

    // Exit maximize when the pane count changes and restore the canonical
    // layout for the new count (panel sizes still reflect the maximize).
    if (focusedPaneId) {
      savedLayoutRef.current = null;
      setFocusedPaneId(null);
      applyWorkspaceGridLayout(
        rowGroupRef,
        topGroupRef,
        bottomGroupRef,
        defaultWorkspaceGridLayout(count),
      );
      return;
    }

    const layout = readWorkspaceGridLayout(rowGroupRef, topGroupRef, bottomGroupRef, initialLayout);
    applyWorkspaceGridLayout(
      rowGroupRef,
      topGroupRef,
      bottomGroupRef,
      applyWorkspaceGridCountChange(prevCount, count, layout),
    );
  }, [count, focusedPaneId, initialLayout, setFocusedPaneId]);

  function renderCell(index: number, showControls: boolean) {
    const pane = panes[index];
    if (!pane) return null;
    const sourceSessionId = paneSourceSessionId(pane);
    const hasSourceSessionPane =
      sourceSessionId !== undefined &&
      panes.some(
        (candidate) => candidate.kind === "session" && candidate.sessionId === sourceSessionId,
      );

    return (
      <WorkspaceGridCell
        key={pane.id}
        pane={pane}
        onCloseSession={onCloseSession}
        showControls={showControls}
        isMaximized={focusedPaneId === pane.id}
        onFocusPane={setFocusedPaneId}
        onMinimize={handleMinimize}
        hasSourceSessionPane={hasSourceSessionPane}
      />
    );
  }

  return (
    <ResizablePanelGroup ref={rowGroupRef} direction="vertical" className="h-full w-full">
      <ResizablePanel defaultSize={initialLayout.rows[0]} minSize={0} className={transitionClass}>
        <ResizablePanelGroup ref={topGroupRef} direction="horizontal">
          <ResizablePanel
            defaultSize={initialLayout.top[0]}
            minSize={0}
            className={transitionClass}
          >
            {renderCell(0, count > 1)}
          </ResizablePanel>

          {renderResizeHandle(1)}

          <ResizablePanel
            defaultSize={initialLayout.top[1]}
            minSize={0}
            className={transitionClass}
          >
            {renderCell(1, true)}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      {renderResizeHandle(2)}

      <ResizablePanel defaultSize={initialLayout.rows[1]} minSize={0} className={transitionClass}>
        <ResizablePanelGroup ref={bottomGroupRef} direction="horizontal">
          <ResizablePanel
            defaultSize={initialLayout.bottom[0]}
            minSize={0}
            className={transitionClass}
          >
            {renderCell(2, true)}
          </ResizablePanel>

          {renderResizeHandle(3)}

          <ResizablePanel
            defaultSize={initialLayout.bottom[1]}
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

interface WorkspaceGridCellProps {
  pane: WorkspacePane;
  onCloseSession: (sessionId: string) => void;
  hasSourceSessionPane: boolean;
  showControls: boolean;
  isMaximized: boolean;
  onFocusPane: (paneId: string) => void;
  onMinimize: () => void;
}

function WorkspaceGridCell({
  pane,
  onCloseSession,
  hasSourceSessionPane,
  showControls,
  isMaximized,
  onFocusPane,
  onMinimize,
}: WorkspaceGridCellProps) {
  // The cell is a host: it hands its rendered pane the "normal" variant and this
  // slot (the hover-overlay controls), and the pane declares its own actions into
  // it — same contract as the pager, so the artifact's controls can't drift.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const btnClass = PANE_OVERLAY_BUTTON_CLASS;
  const iconClass = PANE_OVERLAY_ICON_CLASS;
  const showControlsPersistently = isMaximized;
  const associatedSessionId = paneSourceSessionId(pane);
  const shouldRenderSessionOverlay =
    associatedSessionId !== undefined &&
    pane.kind !== "session" &&
    (isMaximized || !hasSourceSessionPane);

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
              {pane.kind === "session" && !pane.isLinkedOnly && (
                <button
                  onClick={() => onCloseSession(pane.sessionId)}
                  className={btnClass}
                  aria-label="Remove"
                >
                  <X className={iconClass} />
                </button>
              )}
            </>
          )}
        </div>
      )}

      <WorkspacePaneView pane={pane} variant="normal" actionsSlot={actionsSlot} />

      {shouldRenderSessionOverlay && (
        <SessionOverlay key={associatedSessionId} sessionId={associatedSessionId} />
      )}
    </div>
  );
}
