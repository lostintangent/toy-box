import {
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Point } from "../../document";
import type { EditorStore, Tool } from "../../store";
import {
  gestureOwnerForPointer,
  gestureOwnerForTool,
  type GestureController,
  type GestureOutcome,
  type GestureOwner,
  type GestureSource,
  type TouchPointPair,
  viewportPoint,
} from "./gesture";
import { startPinchGesture } from "./pinch";

type CapturedGesture = GestureController & {
  captureTarget: HTMLDivElement;
  pointerIds: readonly number[];
};

function releasePointerCapture(
  gesture: CapturedGesture,
  activeTouches: ReadonlyMap<number, Point>,
) {
  for (const pointerId of gesture.pointerIds) {
    // Keep tracking each touch until it lifts, even after its gesture ends.
    if (activeTouches.has(pointerId)) continue;
    if (gesture.captureTarget.hasPointerCapture(pointerId)) {
      gesture.captureTarget.releasePointerCapture(pointerId);
    }
  }
}

function finishCapturedGesture(
  gesture: CapturedGesture,
  outcome: GestureOutcome,
  activeTouches: ReadonlyMap<number, Point>,
  endEditorGesture?: () => void,
) {
  try {
    gesture.finish(outcome);
  } finally {
    try {
      endEditorGesture?.();
    } finally {
      releasePointerCapture(gesture, activeTouches);
    }
  }
}

/** Routes exclusive single-pointer gestures and promotes two touches to viewport pinch. */
export function useGesture({
  store,
  activeTool,
  sources,
  focusEditor,
}: {
  store: EditorStore;
  activeTool: Tool;
  sources: Record<GestureOwner, GestureSource>;
  focusEditor: () => void;
}) {
  const capturedGestureRef = useRef<CapturedGesture | null>(null);
  const activeTouchesRef = useRef(new Map<number, Point>());

  function finish(outcome: GestureOutcome) {
    const gesture = capturedGestureRef.current;
    capturedGestureRef.current = null;
    if (!gesture) {
      store.actions.endGesture();
      return;
    }
    finishCapturedGesture(gesture, outcome, activeTouchesRef.current, () =>
      store.actions.endGesture(),
    );
  }

  function leaveHover() {
    sources[gestureOwnerForTool(activeTool)].hover?.leave();
  }

  /** Captures the claimed gesture's pointers, or rolls back a claim that throws. */
  function capture(
    target: HTMLDivElement,
    pointerIds: readonly number[],
    claim: () => GestureController | null,
  ): boolean {
    let controller: GestureController | null = null;
    try {
      controller = claim();
      if (!controller) return false;
      capturedGestureRef.current = { ...controller, captureTarget: target, pointerIds };
      for (const pointerId of pointerIds) target.setPointerCapture(pointerId);
      return true;
    } catch (error) {
      if (controller) finish("cancel");
      else store.actions.endGesture();
      throw error;
    }
  }

  useLayoutEffect(() => {
    const activeTouches = activeTouchesRef.current;
    const subscription = store.subscribe((state) => {
      const gesture = capturedGestureRef.current;
      if (state.gesture || !gesture) return;
      // Tool, document, and read-only transitions can clear semantic gesture state externally.
      capturedGestureRef.current = null;
      finishCapturedGesture(gesture, "cancel", activeTouches);
    });
    return () => {
      subscription.unsubscribe();
      activeTouches.clear();
      const gesture = capturedGestureRef.current;
      capturedGestureRef.current = null;
      if (!gesture) return;
      finishCapturedGesture(gesture, "cancel", activeTouches);
    };
  }, [store]);

  function startTouchPair(event: ReactPointerEvent<HTMLDivElement>): boolean {
    if (event.pointerType !== "touch") return false;

    const activeTouches = activeTouchesRef.current;
    const capturedGesture = capturedGestureRef.current;
    if (capturedGesture && capturedGesture.pointerIds.length > 1) {
      event.preventDefault();
      return true;
    }

    activeTouches.set(event.pointerId, viewportPoint(event, event.currentTarget));
    const points = touchPointPair(activeTouches);
    if (!points) return false;

    event.preventDefault();
    leaveHover();
    finish("cancel");
    return capture(event.currentTarget, [...activeTouches.keys()], () => {
      const pinch = startPinchGesture(store, points);
      return (
        pinch && {
          update: () => {
            const nextPoints = touchPointPair(activeTouches);
            if (nextPoints) pinch.update(nextPoints);
          },
          finish: pinch.finish,
        }
      );
    });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    focusEditor();
    if (startTouchPair(event)) return;
    if (store.state.gesture) return;
    const owner = gestureOwnerForPointer({ button: event.button, activeTool });
    if (!owner) return;

    const passiveOwner = gestureOwnerForTool(activeTool);
    if (passiveOwner !== owner) sources[passiveOwner].hover?.leave();
    capture(event.currentTarget, [event.pointerId], () => sources[owner].claim(event));
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" && activeTouchesRef.current.has(event.pointerId)) {
      activeTouchesRef.current.set(event.pointerId, viewportPoint(event, event.currentTarget));
    }
    const gesture = capturedGestureRef.current;
    if (gesture?.pointerIds.includes(event.pointerId)) gesture.update(event);
    else if (!store.state.gesture) {
      sources[gestureOwnerForTool(activeTool)].hover?.update(event);
    }
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>, outcome: GestureOutcome) {
    if (event.pointerType === "touch") activeTouchesRef.current.delete(event.pointerId);
    if (capturedGestureRef.current?.pointerIds.includes(event.pointerId)) finish(outcome);
  }

  return {
    viewportProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event) => finishPointer(event, "commit"),
      onPointerCancel: (event) => finishPointer(event, "cancel"),
      onPointerLeave: leaveHover,
      onContextMenu: (event) => event.preventDefault(),
    } satisfies HTMLAttributes<HTMLDivElement>,
    finish,
    cancel: () => finish("cancel"),
    leaveHover,
  };
}

function touchPointPair(touches: ReadonlyMap<number, Point>): TouchPointPair | null {
  if (touches.size !== 2) return null;
  const pair = [...touches.values()];
  return [pair[0]!, pair[1]!];
}
