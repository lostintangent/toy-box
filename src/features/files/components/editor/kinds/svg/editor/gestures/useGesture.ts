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
} from "./gesture";
import type { EditorStore, Tool } from "../../store";

type CapturedGesture = {
  controller: GestureController<ReactPointerEvent<HTMLDivElement>>;
  owner: GestureOwner;
  captureTarget: HTMLDivElement;
  pointerId: number;
};

function releasePointerCapture(gesture: CapturedGesture) {
  if (gesture.captureTarget.hasPointerCapture(gesture.pointerId)) {
    gesture.captureTarget.releasePointerCapture(gesture.pointerId);
  }
}

function finishCapturedGesture(
  gesture: CapturedGesture,
  outcome: GestureOutcome,
  endEditorGesture?: () => void,
) {
  try {
    gesture.controller.finish(outcome);
  } finally {
    try {
      endEditorGesture?.();
    } finally {
      releasePointerCapture(gesture);
    }
  }
}

/** Lets one source claim pointer-down, then routes the captured pointer to its controller. */
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
    const subscription = store.subscribe((state) => {
      const gesture = capturedGestureRef.current;
      if (state.gesture || !gesture) return;
      // Tool, document, and read-only transitions can clear semantic gesture state externally.
      capturedGestureRef.current = null;
      finishCapturedGesture(gesture, "cancel");
    });
    return () => {
      subscription.unsubscribe();
      const gesture = capturedGestureRef.current;
      capturedGestureRef.current = null;
      if (!gesture) return;
      finishCapturedGesture(gesture, "cancel");
    };
  }, [store]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    focusEditor();
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
      capturedGestureRef.current = {
        controller,
        owner,
        captureTarget: event.currentTarget,
        pointerId: event.pointerId,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch (error) {
      if (controller) finish("cancel");
      else store.actions.endGesture();
      throw error;
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = capturedGestureRef.current;
    if (gesture?.pointerId === event.pointerId) gesture.controller.update(event);
    else if (!store.state.gesture) {
      sourceFor(gestureOwnerForTool(activeTool))?.hover?.update(event);
    }
  }

  return {
    viewportProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event) => {
        if (capturedGestureRef.current?.pointerId === event.pointerId) finish("commit");
      },
      onPointerCancel: (event) => {
        if (capturedGestureRef.current?.pointerId === event.pointerId) finish("cancel");
      },
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
