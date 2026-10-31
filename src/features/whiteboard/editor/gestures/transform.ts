import type { PointerEvent as ReactPointerEvent } from "react";
import {
  applyHistoryEntry,
  createAttributesHistoryEntry,
  snapshotAttribute,
  type AttributeSnapshot,
} from "../../document/history";
import type { EditorStore, Point } from "../../store";
import type { SelectionFrame, SelectionHandle } from "../selection/frame";
import {
  applyScreenTransform,
  createTransformHistoryEntry,
  resizeSelectionTransform,
  rotateSelectionTransform,
  transformPoint,
  translationMatrix,
  type ElementTransformCapture,
  type Matrix2D,
} from "../selection/transform";
import type { GestureController } from "./gesture";

const DRAG_THRESHOLD_PX = 4;

type TransformState =
  | {
      mode: "pending-move";
      start: Point;
      captures: readonly ElementTransformCapture[];
      onMoveStart: () => void;
    }
  | {
      mode: "move";
      start: Point;
      captures: readonly ElementTransformCapture[];
    }
  | {
      mode: "resize";
      frame: SelectionFrame;
      handle: SelectionHandle;
      start: Point;
      captures: readonly ElementTransformCapture[];
    }
  | {
      mode: "rotate";
      center: Point;
      start: Point;
      captures: readonly ElementTransformCapture[];
    };

/** Starts one move, resize, or rotate gesture over selected native SVG elements. */
export function startTransformGesture(
  store: EditorStore,
  initialState: TransformState,
): GestureController<ReactPointerEvent<HTMLDivElement>> | null {
  if (
    !store.actions.beginGesture(
      initialState.mode === "pending-move"
        ? { type: "pending-move" }
        : { type: "transform", mode: initialState.mode },
    )
  ) {
    return null;
  }

  let state = initialState;
  return {
    update(event) {
      const result = updateTransform(
        state,
        { x: event.clientX, y: event.clientY },
        { fromCenter: event.altKey, constrained: event.shiftKey },
      );
      if (!result) return;
      if (state.mode === "pending-move") {
        event.preventDefault();
        state.onMoveStart();
        globalThis.getSelection?.()?.removeAllRanges();
        store.actions.updateGesture({ type: "transform", mode: "move" });
      }
      state = result.state;
      for (const capture of state.captures) applyScreenTransform(capture, result.transform);
    },
    finish(outcome) {
      if (state.mode === "pending-move") return;
      const entry = createTransformHistoryEntry(state.captures);
      if (outcome === "commit") store.actions.commit(entry);
      else if (entry) applyHistoryEntry(entry, "undo");
    },
  };
}

/** Starts editing one line endpoint in the line's local coordinate space. */
export function startLineEndpointGesture({
  store,
  element,
  endpoint,
  screenInverse,
  before,
}: {
  store: EditorStore;
  element: SVGGraphicsElement;
  endpoint: "start" | "end";
  screenInverse: Matrix2D;
  before: readonly AttributeSnapshot[];
}): GestureController<ReactPointerEvent<HTMLDivElement>> | null {
  if (!store.actions.beginGesture({ type: "line-endpoint" })) return null;
  const prefix = endpoint === "start" ? "1" : "2";

  return {
    update(event) {
      const point = transformPoint(screenInverse, { x: event.clientX, y: event.clientY });
      element.setAttribute(`x${prefix}`, String(Number(point.x.toFixed(3))));
      element.setAttribute(`y${prefix}`, String(Number(point.y.toFixed(3))));
    },
    finish(outcome) {
      const entry = createAttributesHistoryEntry(
        before.map((attribute) => ({
          element,
          before: attribute,
          after: snapshotAttribute(element, attribute.name, attribute.namespace),
        })),
      );
      if (outcome === "commit") store.actions.commit(entry);
      else if (entry) applyHistoryEntry(entry, "undo");
    },
  };
}

function updateTransform(
  state: TransformState,
  pointer: Point,
  modifiers: { fromCenter: boolean; constrained: boolean },
): { state: Exclude<TransformState, { mode: "pending-move" }>; transform: Matrix2D } | null {
  switch (state.mode) {
    case "pending-move": {
      const x = pointer.x - state.start.x;
      const y = pointer.y - state.start.y;
      if (Math.hypot(x, y) < DRAG_THRESHOLD_PX) return null;
      return {
        state: { mode: "move", start: state.start, captures: state.captures },
        transform: translationMatrix(x, y),
      };
    }
    case "move":
      return {
        state,
        transform: translationMatrix(pointer.x - state.start.x, pointer.y - state.start.y),
      };
    case "resize": {
      const transform = resizeSelectionTransform({
        frame: state.frame,
        handle: state.handle,
        start: state.start,
        pointer,
        fromCenter: modifiers.fromCenter,
        preserveAspectRatio: modifiers.constrained,
      });
      if (!transform) return null;
      return {
        state,
        transform,
      };
    }
    case "rotate":
      return {
        state,
        transform: rotateSelectionTransform({
          center: state.center,
          start: state.start,
          pointer,
          snap: modifiers.constrained,
        }),
      };
  }
}
