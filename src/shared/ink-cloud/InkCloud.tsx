import { useEffect, useRef } from "react";
import { cn } from "@/shared/utils";
import { createInkCloud, type Ink, type Point, type Reaction, type Traveler } from "./cloud";

export type { Ink, Reaction, Traveler } from "./cloud";

/**
 * An idle ink cloud on a canvas sized by its class names. It reacts to the
 * pointer anywhere on the page: nearby it parts or stirs the motes, farther
 * away the whole cloud leans toward it. Inks and the traveler should be stable
 * across renders; a new object restarts the cloud.
 */
export function InkCloud({
  inks,
  reaction,
  traveler,
  className,
}: {
  /** Colors may be any CSS color, including `var()` references. */
  inks: readonly Ink[];
  reaction: Reaction;
  traveler?: Traveler;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;

    // The canvas has a fixed size, and a cloud is short-lived enough to read its inks once.
    const { canvas } = context;
    const { clientWidth: width, clientHeight: height } = canvas;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const cloud = createInkCloud({
      inks: inks.map((ink) => ({ ...ink, color: resolveColor(canvas, ink.color) })),
      reaction,
      traveler: traveler && { ...traveler, color: resolveColor(canvas, traveler.color) },
      surface: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    });

    // Any pointer counts: a hovering mouse, a pen, or a finger. A pointer that goes out to
    // nothing has left the window, been lifted, or been cancelled, so the cloud lets it go.
    let pointer: Point | null = null;
    const follow = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      };
    };
    const leave = (event: PointerEvent) => {
      if (!event.relatedTarget) pointer = null;
    };
    window.addEventListener("pointermove", follow);
    window.addEventListener("pointerdown", follow);
    window.addEventListener("pointerout", leave);

    let previousTime = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      cloud.advance(Math.min(0.05, (now - previousTime) / 1000), pointer);
      previousTime = now;
      context.clearRect(0, 0, width, height);
      cloud.paint(context, width, height);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", follow);
      window.removeEventListener("pointerdown", follow);
      window.removeEventListener("pointerout", leave);
    };
  }, [inks, reaction, traveler]);

  return <canvas ref={canvasRef} aria-hidden className={cn("block", className)} />;
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
