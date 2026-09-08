import { useEffect, useRef } from "react";
import { createInkSplatterPainter, type TypingEffectPainter } from "./painter";

interface TypingEffectEngine {
  pulse: () => void;
  stop: () => void;
}

/** Value-driven ink feedback drawn behind a message composer's toolbar controls. */
export function TypingEffect({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<TypingEffectEngine>(null);
  const previousValue = useRef(value);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = createEngine(canvas, createInkSplatterPainter());
    engineRef.current = engine;

    return () => {
      engineRef.current = null;
      engine.stop();
    };
  }, []);

  useEffect(() => {
    if (previousValue.current === value) return;
    previousValue.current = value;
    engineRef.current?.pulse();
  }, [value]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas ref={canvasRef} className="size-full" />
    </div>
  );
}

function createEngine(canvas: HTMLCanvasElement, painter: TypingEffectPainter): TypingEffectEngine {
  const context = canvas.getContext("2d");
  if (!context) {
    return {
      pulse() {},
      stop() {},
    };
  }
  const initialSize = canvas.getBoundingClientRect();
  let width = initialSize.width;
  let height = initialSize.height;
  let sizeChanged = true;
  let frame = 0;
  let previousTime = 0;
  let ink = "";

  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(([entry]) => {
          if (!entry) return;
          width = entry.contentRect.width;
          height = entry.contentRect.height;
          sizeChanged = true;
        });
  resizeObserver?.observe(canvas);

  function synchronizeSize(target: CanvasRenderingContext2D) {
    if (!sizeChanged) return;
    sizeChanged = false;

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    target.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  const tick = (now: number) => {
    const elapsed = Math.min(0.05, (now - previousTime) / 1000);
    previousTime = now;
    const running = painter.advance(elapsed);

    synchronizeSize(context);
    context.clearRect(0, 0, width, height);
    context.globalAlpha = 1;
    painter.paint(context, width, height, ink);

    frame = running ? requestAnimationFrame(tick) : 0;
  };

  return {
    pulse() {
      ink = getComputedStyle(canvas).getPropertyValue("--user-accent").trim();
      painter.pulse();

      if (frame === 0) {
        previousTime = performance.now();
        frame = requestAnimationFrame(tick);
      }
    },
    stop() {
      resizeObserver?.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
