import type { PointerEvent as ReactPointerEvent } from "react";
import type { SvgDocument } from "../../document";
import type { EditorStore, Point, Rect } from "../../store";
import { measureElementFrame, selectionFrameBounds } from "../selection/frame";
import type { GestureController } from "./gesture";

/** Starts a viewport-space marquee that updates the current selection. */
export function startMarqueeGesture({
  document,
  store,
  start,
  additiveSelection,
  select,
}: {
  document: Pick<SvgDocument, "listSelectionCandidates">;
  store: EditorStore;
  start: Point;
  additiveSelection: readonly SVGGraphicsElement[];
  select: (elements: readonly SVGGraphicsElement[]) => void;
}): GestureController<ReactPointerEvent<HTMLDivElement>> | null {
  if (!store.actions.beginGesture({ type: "marquee", rect: { ...start, width: 0, height: 0 } })) {
    return null;
  }

  return {
    update(event) {
      const viewportBounds = event.currentTarget.getBoundingClientRect();
      const rect = marqueeRect(start, {
        x: event.clientX - viewportBounds.left,
        y: event.clientY - viewportBounds.top,
      });
      store.actions.updateGesture({ type: "marquee", rect });
      const enclosed = document.listSelectionCandidates().filter((element) => {
        const frame = measureElementFrame(element, viewportBounds);
        return frame ? containsRect(rect, selectionFrameBounds(frame)) : false;
      });
      select([...new Set([...additiveSelection, ...enclosed])]);
    },
    finish() {},
  };
}

export function marqueeRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function containsRect(container: Rect, candidate: Rect): boolean {
  return (
    candidate.x >= container.x &&
    candidate.y >= container.y &&
    candidate.x + candidate.width <= container.x + container.width &&
    candidate.y + candidate.height <= container.y + container.height
  );
}
