import { describe, expect, test } from "bun:test";
import { hitTestSelectionHandle, measureSelectionFrame, positionSelectionHandles } from "./frame";

describe("SVG selection frames", () => {
  test("preserves one oriented frame and combines multiple elements into one frame", () => {
    const rotated = screenElement(
      { x: 0, y: 0, width: 100, height: 50 },
      { a: 0, b: 1, c: -1, d: 0, e: 100, f: 20 },
    );
    expect(measureSelectionFrame([rotated], { left: 0, top: 0 })).toEqual({
      corners: [
        { x: 100, y: 20 },
        { x: 100, y: 120 },
        { x: 50, y: 120 },
        { x: 50, y: 20 },
      ],
      center: { x: 75, y: 70 },
    });

    const left = screenElement(
      { x: 10, y: 20, width: 30, height: 40 },
      { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    );
    const right = screenElement(
      { x: 0, y: 0, width: 20, height: 10 },
      { a: 1, b: 0, c: 0, d: 1, e: 100, f: 5 },
    );
    expect(measureSelectionFrame([left, right], { left: 0, top: 0 })).toEqual({
      corners: [
        { x: 10, y: 5 },
        { x: 120, y: 5 },
        { x: 120, y: 60 },
        { x: 10, y: 60 },
      ],
      center: { x: 65, y: 32.5 },
    });
  });

  test("keeps resize and rotation handles at stable screen-space positions", () => {
    const frame = {
      corners: [
        { x: 20, y: 20 },
        { x: 120, y: 20 },
        { x: 120, y: 80 },
        { x: 20, y: 80 },
      ],
      center: { x: 70, y: 50 },
    } as const;

    const handles = positionSelectionHandles(frame);
    expect(handles.map((positioned) => positioned.handle)).toEqual([
      "resize-nw",
      "resize-n",
      "resize-ne",
      "resize-e",
      "resize-se",
      "resize-s",
      "resize-sw",
      "resize-w",
      "rotate",
    ]);
    expect(handles.at(-1)?.point).toEqual({ x: 70, y: -6 });
    expect(hitTestSelectionHandle(frame, { x: 23, y: 24 })).toBe("resize-nw");
    expect(hitTestSelectionHandle(frame, { x: 35, y: 20 })).toBeNull();
    expect(hitTestSelectionHandle(frame, { x: 35, y: 20 }, true)).toBe("resize-nw");
  });

  test("omits midpoint handles that would crowd a compact edge", () => {
    const compactWidth = selectionFrame(24, 60);
    expect(positionSelectionHandles(compactWidth).map((positioned) => positioned.handle)).toEqual([
      "resize-nw",
      "resize-ne",
      "resize-e",
      "resize-se",
      "resize-sw",
      "resize-w",
      "rotate",
    ]);
    expect(hitTestSelectionHandle(compactWidth, { x: 12, y: 0 })).toBeNull();

    const compactHeight = selectionFrame(100, 24);
    expect(positionSelectionHandles(compactHeight).map((positioned) => positioned.handle)).toEqual([
      "resize-nw",
      "resize-n",
      "resize-ne",
      "resize-se",
      "resize-s",
      "resize-sw",
      "rotate",
    ]);
  });
});

function screenElement(
  bounds: { x: number; y: number; width: number; height: number },
  matrix: { a: number; b: number; c: number; d: number; e: number; f: number },
) {
  return {
    localName: "rect",
    getBBox: () => bounds,
    getScreenCTM: () => matrix,
  } as unknown as SVGGraphicsElement;
}

function selectionFrame(width: number, height: number) {
  return {
    corners: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    center: { x: width / 2, y: height / 2 },
  } as const;
}
