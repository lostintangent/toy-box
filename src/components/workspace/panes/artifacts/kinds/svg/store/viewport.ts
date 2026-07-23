import type { Point, Rect, Size, Viewport } from "./types";

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 10;
const ZOOM_STEP = 1.1;

type ViewportPosition = Pick<Viewport, "zoom" | "panX" | "panY">;

export const DEFAULT_VIEWPORT: Viewport = {
  mode: { type: "fit-page" },
  zoom: 1,
  panX: 0,
  panY: 0,
  size: { width: 0, height: 0 },
};

export function fitViewport(
  bounds: Rect | null,
  viewportWidth: number,
  viewportHeight: number,
  maximumZoom = MAX_ZOOM,
): ViewportPosition {
  if (!bounds || viewportWidth <= 0 || viewportHeight <= 0) {
    return { zoom: 1, panX: 0, panY: 0 };
  }
  if (bounds.width <= 0 || bounds.height <= 0) return { zoom: 1, panX: 0, panY: 0 };

  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(
      (viewportWidth * 0.9) / bounds.width,
      (viewportHeight * 0.9) / bounds.height,
      maximumZoom,
      MAX_ZOOM,
    ),
  );
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    zoom,
    panX: viewportWidth / 2 / zoom - centerX,
    panY: viewportHeight / 2 / zoom - centerY,
  };
}

export function resolveViewport(
  mode: Viewport["mode"],
  page: Rect | null,
  size: Size,
): ViewportPosition {
  if (mode.type === "manual") return { zoom: 1, panX: 0, panY: 0 };
  if (!page) return { zoom: 1, panX: 0, panY: 0 };
  const bounds = mode.type === "fit-page" ? page : mode.bounds;
  return fitViewport(bounds, size.width, size.height, mode.type === "fit-page" ? 1 : undefined);
}

export function toDocumentPoint(viewport: Viewport, viewportPoint: Point): Point {
  return {
    x: viewportPoint.x / viewport.zoom - viewport.panX,
    y: viewportPoint.y / viewport.zoom - viewport.panY,
  };
}

export function zoomViewport(
  viewport: Viewport,
  direction: "in" | "out",
  viewportPoint: Point = {
    x: viewport.size.width / 2,
    y: viewport.size.height / 2,
  },
): ViewportPosition {
  const factor = direction === "in" ? ZOOM_STEP : 1 / ZOOM_STEP;
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewport.zoom * factor));
  const documentPoint = toDocumentPoint(viewport, viewportPoint);
  return {
    zoom,
    panX: viewportPoint.x / zoom - documentPoint.x,
    panY: viewportPoint.y / zoom - documentPoint.y,
  };
}

export function panViewport(viewport: Viewport, viewportDelta: Point): ViewportPosition {
  return {
    zoom: viewport.zoom,
    panX: viewport.panX + viewportDelta.x / viewport.zoom,
    panY: viewport.panY + viewportDelta.y / viewport.zoom,
  };
}
