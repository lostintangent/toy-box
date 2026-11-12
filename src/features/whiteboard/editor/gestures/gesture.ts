import type { PointerEvent as ReactPointerEvent } from "react";
import type { Point } from "../../document";
import { toDocumentPoint, type EditorStore, type Gesture, type Tool } from "../../store";

export type GestureOwner = "viewport" | "drawing" | "selection";
export type GestureOutcome = "commit" | "cancel";

/** Owns every pointer update after a gesture source claims pointer-down. */
export type GestureController<Event = ReactPointerEvent<HTMLDivElement>> = {
  update: (event: Event) => void;
  finish: (outcome: GestureOutcome) => void;
};

export type TouchPointPair = readonly [Point, Point];

/** Offers pointer-down to one editor capability and optionally claims it with a controller. */
export type GestureSource = {
  claim: (event: ReactPointerEvent<HTMLDivElement>) => GestureController | null;
  hover?: {
    update: (event: ReactPointerEvent<HTMLDivElement>) => void;
    leave: () => void;
  };
};

/** Where a pointer lands relative to the viewport element. */
export function viewportPoint(
  { clientX, clientY }: Pick<MouseEvent, "clientX" | "clientY">,
  viewportElement: Element,
): Point {
  const bounds = viewportElement.getBoundingClientRect();
  return { x: clientX - bounds.left, y: clientY - bounds.top };
}

/** Where a pointer on the viewport element lands, in viewport and document coordinates. */
export function pointerCoordinates(
  store: EditorStore,
  event: ReactPointerEvent<HTMLDivElement>,
): { viewport: Point; document: Point } {
  const viewport = viewportPoint(event, event.currentTarget);
  return { viewport, document: toDocumentPoint(store.state.viewport, viewport) };
}

/** Resolves the active gesture tool while Space is held. */
export function activeToolForGesture({
  activeTool,
  spacePressed,
}: {
  activeTool: Tool;
  spacePressed: boolean;
}): Tool {
  if (!spacePressed) return activeTool;
  return activeTool === "hand" ? "select" : "hand";
}

/** Selects which editor source may claim a pointer gesture. */
export function gestureOwnerForPointer({
  button,
  activeTool,
}: {
  button: number;
  activeTool: Tool;
}): GestureOwner | null {
  if (button === 1) return "viewport";
  if (button !== 0) return null;
  return gestureOwnerForTool(activeTool);
}

export function gestureOwnerForTool(activeTool: Tool): GestureOwner {
  if (activeTool === "hand") return "viewport";
  return activeTool === "select" ? "selection" : "drawing";
}

/** Whether the gesture only moves the viewport, leaving the document untouched. */
export function isNavigating(gesture: Gesture | null): boolean {
  return gesture?.type === "pan" || gesture?.type === "pinch";
}
