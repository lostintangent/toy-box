import { useEffect, useRef, useState, type RefObject } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useAtom } from "@tanstack/react-store";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { useFocusedPaneAtom } from "@workspace/hooks/layout/surface";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/shared/components/ui/resizable";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { WorkspacePaneView } from "../panes/WorkspacePaneView";
import { PANE_OVERLAY_BUTTON_CLASS, PANE_OVERLAY_ICON_CLASS } from "../panes/shell/paneControls";
import { SessionOverlay } from "@sessions/components/SessionOverlay";
import { cn } from "@/shared/utils";
import { paneSourceSessionId, type WorkspacePane } from "@workspace/model/panes";

/** Resizable desktop host for up to four workspace panes. Pane count determines
 *  the grid shape; user resizing is preserved across incremental changes, and
 *  the shared focus value drives maximize and restore. */
export interface WorkspaceGridProps {
  panes: WorkspacePane[];
  resolvePaneClose: (pane: WorkspacePane) => (() => void) | undefined;
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

export function resolveGridSessionOverlayId(
  pane: WorkspacePane,
  panes: readonly WorkspacePane[],
  isMaximized: boolean,
): string | undefined {
  if (pane.kind === "session") return undefined;

  const sourceSessionId = paneSourceSessionId(pane);
  if (sourceSessionId === undefined) return undefined;

  const sourceSessionIsVisible = panes.some(
    (candidate) => candidate.kind === "session" && candidate.sessionId === sourceSessionId,
  );
  return isMaximized || !sourceSessionIsVisible ? sourceSessionId : undefined;
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

export function WorkspaceGrid({ panes, resolvePaneClose }: WorkspaceGridProps) {
  const count = panes.length;
  const [isDragging, setIsDragging] = useState(false);
  const [focusedPaneId, setFocusedPaneId] = useAtom(useFocusedPaneAtom());

  // Group defaults are fixed at mount; later count changes apply a complete layout.
  const [initialLayout] = useState(() => defaultWorkspaceGridLayout(count));

  const rowGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const topGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const bottomGroupRef = useRef<ImperativePanelGroupHandle>(null);
  const savedLayoutRef = useRef<WorkspaceGridLayout | null>(null);
  const prevCountRef = useRef(count);

  const transitionClass = !isDragging ? "transition-[flex-grow] duration-300 ease-layout" : "";
  const isResizeLocked = focusedPaneId !== null;

  function restoreLayout() {
    const saved = savedLayoutRef.current;
    savedLayoutRef.current = null;

    applyWorkspaceGridLayout(
      rowGroupRef,
      topGroupRef,
      bottomGroupRef,
      saved ?? defaultWorkspaceGridLayout(count),
    );
    setFocusedPaneId(null);
  }

  useHotkey("Escape", restoreLayout, { enabled: focusedPaneId !== null });

  function renderResizeHandle(requiredPaneCount: number) {
    return (
      <ResizableHandle
        disabled={isResizeLocked}
        onDragging={setIsDragging}
        className={cn((count < requiredPaneCount || isResizeLocked) && "hidden")}
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

  function renderCell(index: number) {
    const pane = panes[index];
    if (!pane) return null;
    const isMaximized = focusedPaneId === pane.id;

    const onClosePane = resolvePaneClose(pane);

    return (
      <WorkspaceGridCell
        key={pane.id}
        pane={pane}
        onClosePane={onClosePane}
        showWindowControls={count > 1}
        sessionOverlayId={resolveGridSessionOverlayId(pane, panes, isMaximized)}
        isMaximized={isMaximized}
        onMaximize={() => setFocusedPaneId(pane.id)}
        onRestore={restoreLayout}
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
            {renderCell(0)}
          </ResizablePanel>

          {renderResizeHandle(2)}

          <ResizablePanel
            defaultSize={initialLayout.top[1]}
            minSize={0}
            className={transitionClass}
          >
            {renderCell(1)}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>

      {renderResizeHandle(3)}

      <ResizablePanel defaultSize={initialLayout.rows[1]} minSize={0} className={transitionClass}>
        <ResizablePanelGroup ref={bottomGroupRef} direction="horizontal">
          <ResizablePanel
            defaultSize={initialLayout.bottom[0]}
            minSize={0}
            className={transitionClass}
          >
            {renderCell(2)}
          </ResizablePanel>

          {renderResizeHandle(4)}

          <ResizablePanel
            defaultSize={initialLayout.bottom[1]}
            minSize={0}
            className={transitionClass}
          >
            {renderCell(3)}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

interface WorkspaceGridCellProps {
  pane: WorkspacePane;
  onClosePane?: () => void;
  showWindowControls: boolean;
  sessionOverlayId?: string;
  isMaximized: boolean;
  onMaximize: () => void;
  onRestore: () => void;
}

function WorkspaceGridCell({
  pane,
  onClosePane,
  showWindowControls,
  sessionOverlayId,
  isMaximized,
  onMaximize,
  onRestore,
}: WorkspaceGridCellProps) {
  // The cell hosts pane-declared chrome in targets it owns and positions.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);
  const [statusSlot, setStatusSlot] = useState<HTMLDivElement | null>(null);

  return (
    <div
      className={cn(
        "h-full w-full relative group bg-background",
        showWindowControls && "[--toybox-pane-actions-inset:5rem]",
      )}
    >
      {pane.kind === "session" && pane.isLinkedOnly && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 ring-2 ring-inset ring-user-accent/80"
        />
      )}

      <div
        className={cn(
          "absolute top-3 right-3 z-20 flex gap-1 transition-opacity duration-200",
          isMaximized
            ? "opacity-100"
            : "opacity-0 delay-150 focus-within:opacity-100 focus-within:delay-0 group-hover:opacity-100 group-hover:delay-0 has-[[data-popup-open]]:opacity-100 has-[[data-popup-open]]:delay-0",
        )}
      >
        {/* The pane declares its own actions here, before any window controls. */}
        <div ref={setActionsSlot} className="contents" />
        {showWindowControls &&
          (isMaximized ? (
            <button onClick={onRestore} className={PANE_OVERLAY_BUTTON_CLASS} aria-label="Minimize">
              <Minimize2 className={PANE_OVERLAY_ICON_CLASS} />
            </button>
          ) : (
            <>
              <button
                onClick={onMaximize}
                className={PANE_OVERLAY_BUTTON_CLASS}
                aria-label="Maximize"
              >
                <Maximize2 className={PANE_OVERLAY_ICON_CLASS} />
              </button>
              {onClosePane && (
                <button
                  onClick={onClosePane}
                  className={PANE_OVERLAY_BUTTON_CLASS}
                  aria-label="Close"
                >
                  <X className={PANE_OVERLAY_ICON_CLASS} />
                </button>
              )}
            </>
          ))}
      </div>

      <WorkspacePaneView pane={pane} slots={{ actions: actionsSlot, status: statusSlot }}>
        {sessionOverlayId && <SessionOverlay key={sessionOverlayId} sessionId={sessionOverlayId} />}
      </WorkspacePaneView>
      <div
        ref={setStatusSlot}
        className="pointer-events-none absolute right-3 bottom-3 z-20 flex h-[30px] items-center gap-1.5 [&>*]:pointer-events-auto"
      />
    </div>
  );
}
