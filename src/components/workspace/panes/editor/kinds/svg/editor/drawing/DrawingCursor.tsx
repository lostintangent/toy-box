import { useLayoutEffect, useRef, type RefObject } from "react";
import { styleColor, type EditorStore, type Tool } from "../../store";

/** Renders pointer-size feedback for the pen and eraser tools. */
export function DrawingCursor({
  store,
  activeTool,
  themeForegroundColor,
  viewportRef,
}: {
  store: EditorStore;
  activeTool: Tool;
  themeForegroundColor: string;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const cursorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewportElement = viewportRef.current;
    const cursorElement = cursorRef.current;
    if (!viewportElement || !cursorElement) return;
    const viewport = viewportElement;
    const cursor = cursorElement;

    function hide() {
      cursor.style.display = "none";
    }

    function move(event: PointerEvent) {
      if (activeTool !== "pen" && activeTool !== "eraser") {
        hide();
        return;
      }
      const state = store.state;
      const bounds = viewport.getBoundingClientRect();
      const diameter = Math.max(2, state.styleDefaults.strokeWidth * state.viewport.zoom);
      cursor.style.display = "block";
      cursor.style.left = `${event.clientX - bounds.left - diameter / 2}px`;
      cursor.style.top = `${event.clientY - bounds.top - diameter / 2}px`;
      cursor.style.width = `${diameter}px`;
      cursor.style.height = `${diameter}px`;
      cursor.style.borderColor =
        activeTool === "eraser"
          ? "rgba(128, 128, 128, 0.8)"
          : styleColor(state, themeForegroundColor);
      cursor.style.backgroundColor =
        activeTool === "eraser" ? "rgba(128, 128, 128, 0.2)" : "transparent";
    }

    if (activeTool !== "pen" && activeTool !== "eraser") hide();
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerleave", hide);
    return () => {
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerleave", hide);
    };
  }, [activeTool, store, themeForegroundColor, viewportRef]);

  return (
    <div
      ref={cursorRef}
      className="pointer-events-none absolute z-[7] hidden rounded-full border"
      aria-hidden="true"
    />
  );
}
