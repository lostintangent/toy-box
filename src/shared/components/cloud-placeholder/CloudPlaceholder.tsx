import { useEffect, useRef, type PointerEvent } from "react";
import { cn } from "@/shared/utils";
import { createInkCloud, type Ink, type Point, type Reaction } from "./inkCloud";

export type { Ink, Reaction } from "./inkCloud";

/**
 * A pane before its first message: an idle ink cloud above a caption, filling
 * its region so that the cloud reacts to any pointer in it. Inks should be
 * stable across renders; a new array restarts the cloud.
 */
export function CloudPlaceholder({
  inks,
  reaction,
  title,
  description,
  className,
}: {
  /** Ink colors may be any CSS color, including `var()` references. */
  inks: readonly Ink[];
  reaction: Reaction;
  title: string;
  description: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef<Point | null>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;

    // The canvas has a fixed size, and a placeholder is short-lived enough to read its inks once.
    const { canvas } = context;
    const { clientWidth: width, clientHeight: height } = canvas;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const cloud = createInkCloud({
      inks: inks.map((ink) => ({ ...ink, color: resolveColor(canvas, ink.color) })),
      reaction,
      surface: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    });
    let previousTime = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      cloud.advance(Math.min(0.05, (now - previousTime) / 1000), pointerRef.current);
      previousTime = now;
      context.clearRect(0, 0, width, height);
      cloud.paint(context, width, height);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [inks, reaction]);

  // The cloud reacts to any pointer: a hovering mouse, a pen, or a finger. A lifted finger
  // leaves like a mouse does, since browsers fire pointerleave after pointerup for it.
  const handlePointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointerRef.current = {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };
  };

  return (
    <div
      className={cn("flex items-center justify-center p-8", className)}
      onPointerDown={handlePointer}
      onPointerMove={handlePointer}
      onPointerLeave={() => {
        pointerRef.current = null;
      }}
    >
      <div className="max-w-sm space-y-4 text-center">
        <canvas ref={canvasRef} aria-hidden className="mx-auto block h-44 w-64" />
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

/** Resolves a CSS color, including `var()` references, to a value the canvas can paint with. */
function resolveColor(host: HTMLElement, color: string): string {
  const probe = document.createElement("span");
  probe.style.color = color;
  host.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}
