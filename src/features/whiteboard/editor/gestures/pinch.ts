import type { EditorStore, Point } from "../../store";
import type { GestureController, TouchPointPair } from "./gesture";

type PinchGeometry = {
  center: Point;
  distance: number;
};

/** Starts two-touch viewport navigation with continuous pan and zoom. */
export function startPinchGesture(
  store: EditorStore,
  points: TouchPointPair,
): GestureController<TouchPointPair> | null {
  if (!store.actions.beginGesture({ type: "pinch" })) return null;

  let previous = measurePinch(points);

  return {
    update(nextPoints) {
      const next = measurePinch(nextPoints);
      const scale = previous.distance > 0 ? next.distance / previous.distance : 1;
      store.actions.transformViewport(scale, previous.center, next.center);
      previous = next;
    },
    finish() {},
  };
}

function measurePinch([first, second]: TouchPointPair): PinchGeometry {
  return {
    center: {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    },
    distance: Math.hypot(second.x - first.x, second.y - first.y),
  };
}
