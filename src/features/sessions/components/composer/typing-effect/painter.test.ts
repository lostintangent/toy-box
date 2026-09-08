import { describe, expect, test } from "bun:test";
import { createInkSplatterPainter } from "./painter";

function settle(painter: ReturnType<typeof createInkSplatterPainter>): number {
  for (let frame = 1; frame <= 180; frame += 1) {
    if (!painter.advance(1 / 60)) return frame;
  }

  return Number.POSITIVE_INFINITY;
}

describe("ink splatter painter", () => {
  test("starts settled and settles after a pulse", () => {
    const painter = createInkSplatterPainter();
    expect(painter.advance(1 / 60)).toBe(false);

    painter.pulse();
    expect(painter.advance(1 / 60)).toBe(true);
    expect(settle(painter)).toBeLessThan(180);
  });

  test("settles after sustained input", () => {
    const painter = createInkSplatterPainter();

    for (let pulse = 0; pulse < 500; pulse += 1) {
      painter.pulse();
      painter.advance(1 / 60);
    }

    expect(settle(painter)).toBeLessThan(180);
  });

  test("bounds rendering work during sustained input", () => {
    const painter = createInkSplatterPainter();
    const context = recordingContext();

    for (let pulse = 0; pulse < 400; pulse += 1) painter.pulse();
    painter.advance(1 / 60);
    painter.paint(context.context, 320, 40, "#facc15");

    expect(context.arcs).toBeGreaterThan(0);
    expect(context.arcs).toBeLessThanOrEqual(48);
  });
});

function recordingContext() {
  const record = {
    arcs: 0,
    context: undefined as unknown as CanvasRenderingContext2D,
  };

  const context = {
    globalAlpha: 1,
    fillStyle: "",
    beginPath: () => {},
    arc: () => {
      record.arcs += 1;
    },
    fill: () => {},
  };

  record.context = context as unknown as CanvasRenderingContext2D;
  return record;
}
