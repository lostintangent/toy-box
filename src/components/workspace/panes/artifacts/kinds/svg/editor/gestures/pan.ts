import type { PointerEvent as ReactPointerEvent } from "react";
import type { EditorStore } from "../../store";
import type { GestureController } from "./gesture";

/** Starts navigation from one pointer and owns its incremental viewport movement. */
export function startPanGesture(
  store: EditorStore,
  event: ReactPointerEvent<HTMLDivElement>,
): GestureController<ReactPointerEvent<HTMLDivElement>> | null {
  event.preventDefault();
  if (!store.actions.beginGesture({ type: "pan" })) return null;
  let previous = { x: event.clientX, y: event.clientY };
  return {
    update(event) {
      store.actions.panBy({
        x: event.clientX - previous.x,
        y: event.clientY - previous.y,
      });
      previous = { x: event.clientX, y: event.clientY };
    },
    finish() {},
  };
}
