import { useLayoutEffect, useRef } from "react";
import { useSelector } from "@tanstack/react-store";
import type { EditorStore } from "../../store";
import { renderSvgGrid } from "./grid";

export function GridLayer({
  store,
  colorScheme,
}: {
  store: EditorStore;
  colorScheme: "dark" | "light";
}) {
  const size = useSelector(store, (state) => state.viewport.size);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;
    const targetCanvas: HTMLCanvasElement = canvas;
    const renderingContext: CanvasRenderingContext2D = context;

    let previousViewport = store.state.viewport;
    function paint() {
      const viewport = store.state.viewport;
      previousViewport = viewport;
      renderingContext.setTransform(1, 0, 0, 1, 0, 0);
      renderingContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      renderingContext.setTransform(
        dpr * viewport.zoom,
        0,
        0,
        dpr * viewport.zoom,
        viewport.panX * dpr * viewport.zoom,
        viewport.panY * dpr * viewport.zoom,
      );
      renderSvgGrid(renderingContext, viewport, colorScheme);
    }

    paint();
    const subscription = store.subscribe((state) => {
      if (state.viewport === previousViewport) return;
      paint();
    });
    return () => subscription.unsubscribe();
  }, [colorScheme, dpr, size, store]);

  return (
    <canvas
      ref={canvasRef}
      width={Math.ceil(size.width * dpr)}
      height={Math.ceil(size.height * dpr)}
      style={{ width: size.width, height: size.height }}
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    />
  );
}
