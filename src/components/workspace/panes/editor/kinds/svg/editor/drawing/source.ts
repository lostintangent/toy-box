import type { PointerEvent as ReactPointerEvent } from "react";
import type { SvgDocument } from "../../document";
import {
  resolveActiveTool,
  styleColor,
  toDocumentPoint,
  type EditorStore,
  type Point,
} from "../../store";
import { startDrawingGesture } from "../gestures/drawing";
import type { GestureSource } from "../gestures/gesture";

/** Offers drawing gestures using the active tool and style defaults. */
export function createDrawingGestureSource({
  document,
  store,
  themeForegroundColor,
}: {
  document: SvgDocument;
  store: EditorStore;
  themeForegroundColor: string;
}): GestureSource<ReactPointerEvent<HTMLDivElement>> {
  return {
    owner: "drawing",
    claim(event) {
      event.preventDefault();
      const tool = resolveActiveTool(store.state);
      const start = pointerCoordinates(store, event);
      if (tool === "text") {
        store.actions.beginGesture({
          type: "insert-text",
          documentPoint: start.document,
          viewportPoint: start.viewport,
        });
        return null;
      }

      if (tool === "hand" || tool === "select") return null;
      if (tool === "eraser" && document.listSelectionCandidates().length === 0) return null;

      const style = {
        color: styleColor(store.state, themeForegroundColor),
        width: store.state.styleDefaults.strokeWidth,
        ...(store.state.styleDefaults.fill ? { fill: store.state.styleDefaults.fill } : {}),
      };
      return startDrawingGesture({ document, store, tool, start, style });
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
