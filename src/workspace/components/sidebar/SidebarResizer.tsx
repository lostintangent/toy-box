import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/shared/utils";
import { RESIZE_HANDLE_RULE } from "@/shared/components/ui/resizable";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
} from "@workspace/model/config/layoutPrefs";

/** How far one arrow key nudges the sidebar's edge. */
const KEYBOARD_STEP = 16;

/** The sidebar draws its own trailing border, and its width includes it. */
export const SIDEBAR_BORDER = 1;

/**
 * The width a collapsed sidebar holds: the rail's single action between two
 * insets, plus that border. `SidebarRail` lays itself out against this.
 */
export const SIDEBAR_COLLAPSED_WIDTH = 44 + SIDEBAR_BORDER;

type SidebarDrag = { collapsed: true } | { collapsed: false; width: number };

/**
 * Read a dragged trailing edge as a layout state: past halfway between the rail
 * and the narrowest usable sidebar the drag is asking to collapse, and anything
 * wider is a width to keep.
 */
export function resolveSidebarDrag(width: number): SidebarDrag {
  if (width < (SIDEBAR_COLLAPSED_WIDTH + SIDEBAR_MIN_WIDTH) / 2) return { collapsed: true };
  return { collapsed: false, width: clampSidebarWidth(Math.round(width)) };
}

/**
 * A collapsible sidebar's whole state: the width it holds when expanded and
 * whether it is showing that width or its rail. A sidebar either has all of
 * this or none of it, so it cannot be collapsed without a way back.
 */
export type SidebarCollapseControl = {
  /** The width the sidebar returns to, border included. It is kept while collapsed. */
  expandedWidth: number;
  collapsed: boolean;
  onExpandedWidthChange: (width: number) => void;
  onCollapsedChange: (collapsed: boolean) => void;
};

/**
 * The sidebar's width, and everything that sets it: the drag, the keyboard
 * nudge, and the collapse to the rail. `Sidebar` is its only host, which is what
 * lets it hand the sidebar a drag through CSS rather than props.
 *
 * This resizes a plain element rather than using `ResizableHandle` because
 * `react-resizable-panels` sizes panels only as percentages and explicitly
 * declines to support pixels, while the sidebar holds a fixed pixel width so
 * the workspace panes can keep dividing whatever is left as percentages. Only
 * the handle's appearance is shared, through `RESIZE_HANDLE_RULE` and
 * `--resize-accent-y`.
 *
 * The drag lives here rather than with the layout that owns the persisted
 * width, so following the pointer only re-renders this wrapper: the sidebar
 * arrives as an element and learns the drag through `--sidebar-width` rather
 * than props, so it is never reconciled mid-drag.
 */
export function SidebarResizer({
  expandedWidth,
  collapsed,
  onExpandedWidthChange,
  onCollapsedChange,
  children,
}: SidebarCollapseControl & { children: ReactNode }) {
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const isDragging = dragWidth !== null;
  const currentWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : (dragWidth ?? expandedWidth);

  function applyDrag(edge: number) {
    const drag = resolveSidebarDrag(edge);
    if (drag.collapsed !== collapsed) onCollapsedChange(drag.collapsed);
    if (!drag.collapsed) setDragWidth(drag.width);
  }

  function commitDrag() {
    // A drag that ended on the rail asked to collapse, not to resize, so the
    // sidebar keeps the width it will restore to.
    if (dragWidth !== null && !collapsed) onExpandedWidthChange(dragWidth);
    setDragWidth(null);
  }

  function nudge(edge: number) {
    const drag = resolveSidebarDrag(edge);
    if (drag.collapsed !== collapsed) onCollapsedChange(drag.collapsed);
    if (!drag.collapsed) onExpandedWidthChange(drag.width);
  }

  // The expanded layout holds its restored width while it crossfades out, so the
  // narrowing sidebar clips it instead of squeezing its content. Only a drag that
  // is still widening the sidebar has no crossfade and must track the edge live.
  const style: CSSProperties & { "--sidebar-width": string } = {
    width: currentWidth,
    "--sidebar-width": isDragging && !collapsed ? "100%" : `${expandedWidth - SIDEBAR_BORDER}px`,
  };

  return (
    <>
      <div
        data-sidebar
        style={style}
        className={cn(
          "shrink-0 border-r",
          !isDragging && "transition-[width] duration-300 ease-layout",
        )}
      >
        {children}
      </div>

      <SidebarEdge
        width={currentWidth}
        hidden={collapsed && !isDragging}
        isDragging={isDragging}
        onDragStart={() => setDragWidth(currentWidth)}
        onDrag={applyDrag}
        onDragEnd={commitDrag}
        onNudge={nudge}
      />
    </>
  );
}

/**
 * The sidebar's trailing edge. It reads as the sidebar's border until it is
 * hovered or dragged, so both layouts show the same single rule.
 */
function SidebarEdge({
  width,
  hidden,
  isDragging,
  onDragStart,
  onDrag,
  onDragEnd,
  onNudge,
}: {
  width: number;
  hidden: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDrag: (edge: number) => void;
  onDragEnd: () => void;
  onNudge: (edge: number) => void;
}) {
  const originRef = useRef<{ pointer: number; width: number } | null>(null);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    originRef.current = { pointer: event.clientX, width };
    onDragStart();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const origin = originRef.current;
    if (!origin) return;
    onDrag(origin.width + (event.clientX - origin.pointer));
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!originRef.current) return;
    originRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onDragEnd();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowLeft" ? -KEYBOARD_STEP : event.key === "ArrowRight" ? KEYBOARD_STEP : 0;
    if (step === 0) return;
    event.preventDefault();
    onNudge(width + step);
  }

  const accentGradient = "bg-[image:var(--resize-accent-y)]";

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={hidden ? -1 : 0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      className={cn(
        RESIZE_HANDLE_RULE,
        "z-10 -ml-px shrink-0 cursor-col-resize touch-none select-none",
        "hover:bg-[image:var(--resize-accent-y)]",
        isDragging && accentGradient,
        hidden && "hidden",
      )}
    />
  );
}
