// Geometry and shell for the floating "session window" surfaces — the draggable
// hyper deck (HyperSession) and the bottom-right session hover overlay
// (SessionOverlay), plus the sidebar's live-preview bounds. Positions clamp to the
// viewport; the shared card shell is SESSION_OVERLAY_BASE_CLASS. Lives at the
// workspace root (not under panes/session) because layout, the sidebar, and hooks
// all consume it.

export const SESSION_OVERLAY_SIZE = {
  width: 450,
  height: 600,
  margin: 24,
} as const;

// The shared overlay card shell. Each overlay layers its own positioning and
// enter/exit animation on top of this (see SessionOverlay and HyperSession).
export const SESSION_OVERLAY_BASE_CLASS =
  "overflow-hidden rounded-md border bg-background shadow-xl";

const {
  width: OVERLAY_WIDTH,
  height: OVERLAY_HEIGHT,
  margin: OVERLAY_MARGIN,
} = SESSION_OVERLAY_SIZE;

export type OverlayPosition = {
  x: number;
  y: number;
};

export const VIEWPORT_OVERLAY_BOUNDS = {
  width: OVERLAY_WIDTH,
  height: OVERLAY_HEIGHT,
  maxWidth: `calc(100vw - ${OVERLAY_MARGIN * 2}px)`,
  maxHeight: `calc(100vh - ${OVERLAY_MARGIN * 2}px)`,
} as const;

export const CONTAINER_OVERLAY_BOUNDS = {
  width: OVERLAY_WIDTH,
  height: OVERLAY_HEIGHT,
  maxWidth: `calc(100% - ${OVERLAY_MARGIN * 2}px)`,
  maxHeight: `calc(100% - ${OVERLAY_MARGIN * 2}px)`,
} as const;

// How far the hyper window overlaps the sidebar's right edge, so it reads as
// visually attached to the sidebar rather than floating in open content.
const HYPER_SIDEBAR_OVERLAP = 120;

export function defaultViewportOverlayPosition(): OverlayPosition {
  if (typeof window === "undefined") {
    return {
      x: OVERLAY_MARGIN,
      y: OVERLAY_MARGIN,
    };
  }

  // Open vertically centered and slightly overlapping the sidebar's right edge,
  // so the hyper window is anchored to the sidebar and clearly distinct from the
  // bottom-right pane overlay. When the sidebar is collapsed or absent the edge
  // resolves to ~0 and the clamp drops the window against the left margin.
  const sidebar = document.querySelector('[data-panel-id="sidebar"]');
  const sidebarRight = sidebar?.getBoundingClientRect().right ?? 0;

  return clampViewportOverlayPosition({
    x: sidebarRight - HYPER_SIDEBAR_OVERLAP,
    y: (window.innerHeight - OVERLAY_HEIGHT) / 2,
  });
}

export function clampViewportOverlayPosition(position: OverlayPosition): OverlayPosition {
  if (typeof window === "undefined") return position;

  const width = Math.min(OVERLAY_WIDTH, window.innerWidth - OVERLAY_MARGIN * 2);
  const height = Math.min(OVERLAY_HEIGHT, window.innerHeight - OVERLAY_MARGIN * 2);
  const maxX = Math.max(OVERLAY_MARGIN, window.innerWidth - width - OVERLAY_MARGIN);
  const maxY = Math.max(OVERLAY_MARGIN, window.innerHeight - height - OVERLAY_MARGIN);

  return {
    x: Math.min(Math.max(OVERLAY_MARGIN, position.x), maxX),
    y: Math.min(Math.max(OVERLAY_MARGIN, position.y), maxY),
  };
}
