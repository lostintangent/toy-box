import type { PointerEvent as ReactPointerEvent } from "react";
import type { SvgDocument } from "../../document";
import { applyHistoryEntry } from "../../document/history";
import {
  createSvgEraserNodes,
  createSvgPath,
  createSvgShape,
  pointsToPathData,
  updateSvgShape,
} from "../../document/nodes";
import {
  toDocumentPoint,
  type EditorStore,
  type Fill,
  type HistoryEntry,
  type Point,
  type Tool,
} from "../../store";
import type { GestureController } from "./gesture";

const MIN_DRAWING_GESTURE_PX = 5;

/** Inserts one provisional native SVG edit and owns its commit or rollback. */
export function startDrawingGesture({
  document,
  store,
  tool,
  start,
  style,
}: {
  document: SvgDocument;
  store: EditorStore;
  tool: Exclude<Tool, "hand" | "select" | "text">;
  start: { document: Point; viewport: Point };
  style: { color: string; width: number; fill?: Fill };
}): GestureController<ReactPointerEvent<HTMLDivElement>> | null {
  if (!store.actions.beginGesture({ type: "draw" })) return null;
  if (tool === "pen") return startPathGesture(document, store, start.document, style);
  if (tool === "eraser") {
    return startEraserGesture(document, store, start.document, style.width);
  }
  return startShapeGesture(document, store, tool, start, style);
}

function startPathGesture(
  document: SvgDocument,
  store: EditorStore,
  start: Point,
  style: { color: string; width: number },
) {
  const points = [start];
  const path = createSvgPath(document.root, points, style);
  const entry = document.appendElement(path);
  return drawingGesture(
    store,
    entry,
    ({ document: point }) => {
      points.push(point);
      path.setAttribute("d", pointsToPathData(points));
    },
    () => points.length > 1,
  );
}

function startEraserGesture(
  document: SvgDocument,
  store: EditorStore,
  start: Point,
  width: number,
) {
  const points = [start];
  const nodes = createSvgEraserNodes(document.root, document.page, points, width);
  const entry = document.eraseVisibleContent(nodes);
  return drawingGesture(
    store,
    entry,
    ({ document: point }) => {
      points.push(point);
      nodes.path.setAttribute("d", pointsToPathData(points));
    },
    () => points.length > 1,
  );
}

function startShapeGesture(
  document: SvgDocument,
  store: EditorStore,
  shape: "rectangle" | "ellipse" | "line" | "arrow",
  start: { document: Point; viewport: Point },
  style: { color: string; width: number; fill?: Fill },
) {
  let viewportEnd = start.viewport;
  const created = createSvgShape(document.root, shape, start.document, start.document, style);
  const entry = document.appendElement(created.element, created.definitions);
  return drawingGesture(
    store,
    entry,
    ({ document: end, viewport }) => {
      viewportEnd = viewport;
      updateSvgShape(created.element, shape, start.document, end);
    },
    () =>
      Math.hypot(viewportEnd.x - start.viewport.x, viewportEnd.y - start.viewport.y) >=
      MIN_DRAWING_GESTURE_PX,
  );
}

function drawingGesture(
  store: EditorStore,
  entry: HistoryEntry,
  update: (point: { document: Point; viewport: Point }) => void,
  isComplete: () => boolean,
): GestureController<ReactPointerEvent<HTMLDivElement>> {
  return {
    update(event) {
      update(pointerCoordinates(store, event));
    },
    finish(outcome) {
      if (outcome === "commit" && isComplete()) store.actions.commit(entry);
      else applyHistoryEntry(entry, "undo");
    },
  };
}

function pointerCoordinates(
  store: EditorStore,
  event: ReactPointerEvent<HTMLDivElement>,
): {
  viewport: Point;
  document: Point;
} {
  const viewportBounds = event.currentTarget.getBoundingClientRect();
  const viewportPoint = {
    x: event.clientX - viewportBounds.left,
    y: event.clientY - viewportBounds.top,
  };
  return {
    viewport: viewportPoint,
    document: toDocumentPoint(store.state.viewport, viewportPoint),
  };
}
