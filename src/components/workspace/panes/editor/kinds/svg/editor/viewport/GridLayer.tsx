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
  const viewport = useSelector(store, (state) => state.viewport);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);

    context.setTransform(
      dpr * viewport.zoom,
      0,
      0,
      dpr * viewport.zoom,
      viewport.panX * dpr * viewport.zoom,
      viewport.panY * dpr * viewport.zoom,
    );
    renderSvgGrid(context, viewport, colorScheme);
  }, [colorScheme, dpr, viewport]);

  return (
    <canvas
      ref={canvasRef}
      width={Math.ceil(viewport.size.width * dpr)}
      height={Math.ceil(viewport.size.height * dpr)}
      style={{ width: viewport.size.width, height: viewport.size.height }}
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
    />
  );
}
