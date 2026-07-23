import { matrixFromDom, transformPoint, type Matrix2D } from "./transform";
import type { Point, Rect } from "../../store";

/** The screen-space manipulation frame for one or more selected native SVG elements. */
export type SelectionFrame = {
  corners: readonly [Point, Point, Point, Point];
  center: Point;
  lineEndpoints?: { start: Point; end: Point };
};

export type SelectionHandle =
  | "resize-nw"
  | "resize-n"
  | "resize-ne"
  | "resize-e"
  | "resize-se"
  | "resize-s"
  | "resize-sw"
  | "resize-w"
  | "rotate"
  | "line-start"
  | "line-end";

export const HANDLE_RADIUS = 6;

const HANDLE_HIT_RADIUS = 10;
const COARSE_HANDLE_HIT_RADIUS = 20;
const ROTATION_HANDLE_OFFSET = 26;
// Leaves one handle-radius gap between each corner and midpoint handle.
const MIN_MIDPOINT_HANDLE_EDGE_LENGTH = HANDLE_RADIUS * 6;

type PositionedSelectionHandle = { handle: SelectionHandle; point: Point };

/**
 * Projects one native element through its screen transform relative to the
 * caller's coordinate origin. A zero origin retains client coordinates for hit testing.
 */
export function measureElementFrame(
  element: SVGGraphicsElement,
  origin: Pick<DOMRect, "left" | "top">,
): SelectionFrame | null {
  try {
    const box = element.getBBox();
    const matrix = element.getScreenCTM();
    if (!matrix || box.width < 0 || box.height < 0) return null;
    const screenMatrix = matrixFromDom(matrix);
    const project = (point: Point): Point => {
      const clientPoint = transformPoint(screenMatrix, point);
      return { x: clientPoint.x - origin.left, y: clientPoint.y - origin.top };
    };
    const corners = [
      project({ x: box.x, y: box.y }),
      project({ x: box.x + box.width, y: box.y }),
      project({ x: box.x + box.width, y: box.y + box.height }),
      project({ x: box.x, y: box.y + box.height }),
    ] as const;
    return {
      corners,
      center: {
        x: corners.reduce((sum, point) => sum + point.x, 0) / corners.length,
        y: corners.reduce((sum, point) => sum + point.y, 0) / corners.length,
      },
      ...(element.localName.toLowerCase() === "line"
        ? { lineEndpoints: readLineEndpoints(element, screenMatrix, origin) }
        : {}),
    };
  } catch {
    return null;
  }
}

/** Measures the one manipulation frame represented by the current selection. */
export function measureSelectionFrame(
  elements: readonly SVGGraphicsElement[],
  origin: Pick<DOMRect, "left" | "top">,
): SelectionFrame | null {
  const frames = elements
    .map((element) => measureElementFrame(element, origin))
    .filter((frame): frame is SelectionFrame => frame !== null);
  return combineSelectionFrames(frames);
}

/** Combines member frames into the one manipulation frame shown for the selection. */
export function combineSelectionFrames(frames: readonly SelectionFrame[]): SelectionFrame | null {
  if (frames.length === 0) return null;
  if (frames.length === 1) return frames[0];

  const bounds = boundsOfPoints(frames.flatMap((frame) => frame.corners));
  return {
    corners: [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      { x: bounds.x, y: bounds.y + bounds.height },
    ],
    center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
  };
}

export function selectionFrameBounds(frame: SelectionFrame): Rect {
  return boundsOfPoints(frame.corners);
}

/** Positions the exact adaptive handle set shared by rendering and hit testing. */
export function positionSelectionHandles(frame: SelectionFrame): PositionedSelectionHandle[] {
  if (frame.lineEndpoints) {
    return [
      { handle: "line-start", point: frame.lineEndpoints.start },
      { handle: "line-end", point: frame.lineEndpoints.end },
    ];
  }

  const topMiddle = midpoint(frame.corners[0], frame.corners[1]);
  const rightMiddle = midpoint(frame.corners[1], frame.corners[2]);
  const bottomMiddle = midpoint(frame.corners[2], frame.corners[3]);
  const leftMiddle = midpoint(frame.corners[3], frame.corners[0]);
  const outward = normalizedVector(frame.center, topMiddle);
  const showHorizontalMidpoints =
    pointDistance(frame.corners[0], frame.corners[1]) >= MIN_MIDPOINT_HANDLE_EDGE_LENGTH;
  const showVerticalMidpoints =
    pointDistance(frame.corners[1], frame.corners[2]) >= MIN_MIDPOINT_HANDLE_EDGE_LENGTH;
  const handles: PositionedSelectionHandle[] = [{ handle: "resize-nw", point: frame.corners[0] }];
  if (showHorizontalMidpoints) handles.push({ handle: "resize-n", point: topMiddle });
  handles.push({ handle: "resize-ne", point: frame.corners[1] });
  if (showVerticalMidpoints) handles.push({ handle: "resize-e", point: rightMiddle });
  handles.push({ handle: "resize-se", point: frame.corners[2] });
  if (showHorizontalMidpoints) handles.push({ handle: "resize-s", point: bottomMiddle });
  handles.push({ handle: "resize-sw", point: frame.corners[3] });
  if (showVerticalMidpoints) handles.push({ handle: "resize-w", point: leftMiddle });
  handles.push({
    handle: "rotate",
    point: {
      x: topMiddle.x + outward.x * ROTATION_HANDLE_OFFSET,
      y: topMiddle.y + outward.y * ROTATION_HANDLE_OFFSET,
    },
  });
  return handles;
}

/** Finds the nearest rendered handle inside the pointer-specific hit radius. */
export function hitTestSelectionHandle(
  frame: SelectionFrame,
  point: Point,
  coarsePointer = false,
): SelectionHandle | null {
  const hitRadius = coarsePointer ? COARSE_HANDLE_HIT_RADIUS : HANDLE_HIT_RADIUS;
  let nearest: SelectionHandle | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const positioned of positionSelectionHandles(frame)) {
    const distance = Math.hypot(point.x - positioned.point.x, point.y - positioned.point.y);
    if (distance <= hitRadius && distance < nearestDistance) {
      nearest = positioned.handle;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function boundsOfPoints(points: readonly Point[]): Rect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

function readLineEndpoints(
  element: SVGGraphicsElement,
  screenMatrix: Matrix2D,
  origin: Pick<DOMRect, "left" | "top">,
): { start: Point; end: Point } | undefined {
  const x1 = Number(element.getAttribute("x1") ?? 0);
  const y1 = Number(element.getAttribute("y1") ?? 0);
  const x2 = Number(element.getAttribute("x2") ?? 0);
  const y2 = Number(element.getAttribute("y2") ?? 0);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return undefined;
  const project = (point: Point): Point => {
    const clientPoint = transformPoint(screenMatrix, point);
    return { x: clientPoint.x - origin.left, y: clientPoint.y - origin.top };
  };
  return { start: project({ x: x1, y: y1 }), end: project({ x: x2, y: y2 }) };
}

function midpoint(left: Point, right: Point): Point {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function pointDistance(left: Point, right: Point): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function normalizedVector(start: Point, end: Point): Point {
  const x = end.x - start.x;
  const y = end.y - start.y;
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}
