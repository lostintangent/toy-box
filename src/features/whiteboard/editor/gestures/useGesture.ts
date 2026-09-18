import {
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  gestureOwnerForState,
  gestureOwnerForPointer,
  gestureOwnerForTool,
  type GestureController,
  type GestureOutcome,
  type GestureOwner,
  type GestureSource,
  type TouchPointPair,
} from "./gesture";
import type { EditorStore, Point, Tool } from "../../store";

type CapturedGesture = {
  update: (event: ReactPointerEvent<HTMLDivElement>) => void;
  finish: (outcome: GestureOutcome) => void;
  owner: GestureOwner;
  captureTarget: HTMLDivElement;
  pointerIds: readonly number[];
};

function releasePointerCapture(gesture: CapturedGesture) {
  for (const pointerId of gesture.pointerIds) {
    if (gesture.captureTarget.hasPointerCapture(pointerId)) {
      gesture.captureTarget.releasePointerCapture(pointerId);
    }
  }
}

function capturePointers(gesture: CapturedGesture) {
  for (const pointerId of gesture.pointerIds) {
    gesture.captureTarget.setPointerCapture(pointerId);
  }
}

function finishCapturedGesture(
  gesture: CapturedGesture,
  outcome: GestureOutcome,
  endEditorGesture?: () => void,
) {
  try {
    gesture.finish(outcome);
  } finally {
    try {
      endEditorGesture?.();
    } finally {
      releasePointerCapture(gesture);
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
  sources: readonly GestureSource<ReactPointerEvent<HTMLDivElement>>[];
  focusEditor: () => void;
}) {
  const capturedGestureRef = useRef<CapturedGesture | null>(null);
  const activeTouchesRef = useRef(new Map<number, Point>());

  function sourceFor(owner: GestureOwner) {
    return sources.find((source) => source.owner === owner);
  }

  function finish(outcome: GestureOutcome) {
    const gesture = capturedGestureRef.current;
    capturedGestureRef.current = null;
    if (!gesture) {
      store.actions.endGesture();
      return;
    }
    finishCapturedGesture(gesture, outcome, () => store.actions.endGesture());
  }

  function leaveHover() {
    sourceFor(gestureOwnerForTool(activeTool))?.hover?.leave();
  }

  useLayoutEffect(() => {
    const activeTouches = activeTouchesRef.current;
    const subscription = store.subscribe((state) => {
      const gesture = capturedGestureRef.current;
      if (state.gesture || !gesture) return;
      // Tool, document, and read-only transitions can clear semantic gesture state externally.
      capturedGestureRef.current = null;
      finishCapturedGesture(gesture, "cancel");
    });
    return () => {
      subscription.unsubscribe();
      activeTouches.clear();
      const gesture = capturedGestureRef.current;
      capturedGestureRef.current = null;
      if (!gesture) return;
      finishCapturedGesture(gesture, "cancel");
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

    activeTouches.set(event.pointerId, viewportPoint(event));
    const points = touchPointPair(activeTouches);
    if (!points) return false;
    const viewportSource = sourceFor("viewport");
    if (!viewportSource?.claimTouchPair) return false;

    event.preventDefault();
    leaveHover();
    finish("cancel");

    let controller: GestureController<TouchPointPair> | null = null;
    try {
      controller = viewportSource.claimTouchPair(points);
      if (!controller) return false;

      const claimedController = controller;
      const gesture: CapturedGesture = {
        update: () => {
          const nextPoints = touchPointPair(activeTouches);
          if (nextPoints) claimedController.update(nextPoints);
        },
        finish: (outcome) => claimedController.finish(outcome),
        owner: "viewport",
        captureTarget: event.currentTarget,
        pointerIds: [...activeTouches.keys()],
      };
      capturedGestureRef.current = gesture;
      capturePointers(gesture);
      return true;
    } catch (error) {
      if (controller) finish("cancel");
      else store.actions.endGesture();
      throw error;
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    focusEditor();
    if (startTouchPair(event)) return;
    if (store.state.gesture) return;
    const owner = gestureOwnerForPointer({ button: event.button, activeTool });
    if (!owner) return;
    const source = sourceFor(owner);
    if (!source) return;

    const passiveOwner = gestureOwnerForTool(activeTool);
    if (passiveOwner !== owner) sourceFor(passiveOwner)?.hover?.leave();
    let controller: GestureController<ReactPointerEvent<HTMLDivElement>> | null = null;
    try {
      controller = source.claim(event);
      if (!controller) return;
      const claimedController = controller;
      const gesture: CapturedGesture = {
        update: (nextEvent) => claimedController.update(nextEvent),
        finish: (outcome) => claimedController.finish(outcome),
        owner,
        captureTarget: event.currentTarget,
        pointerIds: [event.pointerId],
      };
      capturedGestureRef.current = gesture;
      capturePointers(gesture);
    } catch (error) {
      if (controller) finish("cancel");
      else store.actions.endGesture();
      throw error;
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch" && activeTouchesRef.current.has(event.pointerId)) {
      activeTouchesRef.current.set(event.pointerId, viewportPoint(event));
    }
    const gesture = capturedGestureRef.current;
    if (gesture?.pointerIds.includes(event.pointerId)) gesture.update(event);
    else if (!store.state.gesture) {
      sourceFor(gestureOwnerForTool(activeTool))?.hover?.update(event);
    }
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>, outcome: GestureOutcome) {
    if (capturedGestureRef.current?.pointerIds.includes(event.pointerId)) finish(outcome);
    if (event.pointerType === "touch") activeTouchesRef.current.delete(event.pointerId);
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
    isActive: () => capturedGestureRef.current !== null || store.state.gesture !== null,
    isOwnedBy(owner: GestureOwner) {
      const gesture = capturedGestureRef.current;
      if (gesture) return gesture.owner === owner;
      return store.state.gesture ? gestureOwnerForState(store.state.gesture) === owner : false;
    },
    leaveHover,
  };
}

function viewportPoint(event: ReactPointerEvent<HTMLDivElement>): Point {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function touchPointPair(touches: ReadonlyMap<number, Point>): TouchPointPair | null {
  if (touches.size !== 2) return null;
  const pair = [...touches.values()];
  return [pair[0]!, pair[1]!];
}
