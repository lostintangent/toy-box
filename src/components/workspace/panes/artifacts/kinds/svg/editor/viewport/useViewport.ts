import { useLayoutEffect, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { EditorStore } from "../../store";
import type { GestureSource } from "../gestures/gesture";
import { startPanGesture } from "../gestures/pan";

/** Owns viewport measurement and wheel input, and offers pan gestures. */
export function useViewport({
  store,
  viewportRef,
}: {
  store: EditorStore;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  useLayoutEffect(() => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) return;

    function applySize(width: number, height: number) {
      if (width <= 0 || height <= 0) return;
      store.actions.resizeViewport({ width: Math.floor(width), height: Math.floor(height) });
    }

    const observer = new ResizeObserver(([entry]) =>
      applySize(entry.contentRect.width, entry.contentRect.height),
    );

    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (store.state.gesture) return;

      const bounds = viewportElement!.getBoundingClientRect();
      store.actions.zoomAt(event.deltaY > 0 ? "out" : "in", {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
    }

    observer.observe(viewportElement);
    viewportElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      observer.disconnect();
      viewportElement.removeEventListener("wheel", handleWheel);
    };
  }, [store, viewportRef]);

  return {
    owner: "viewport",
    claim: (event) => startPanGesture(store, event),
  } satisfies GestureSource<ReactPointerEvent<HTMLDivElement>>;
}
