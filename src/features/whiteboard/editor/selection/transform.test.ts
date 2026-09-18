import { describe, expect, test } from "bun:test";
import {
  invertMatrix,
  multiplyMatrices,
  resizeSelectionTransform,
  rotationMatrix,
  rotateSelectionTransform,
  scaleMatrix,
  serializeMatrix,
  transformAroundPoint,
  transformPoint,
  translationMatrix,
} from "./transform";

const FRAME = {
  corners: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ],
  center: { x: 50, y: 25 },
} as const;

describe("SVG selection transforms", () => {
  test("composes screen-space movement before an existing element transform", () => {
    const moved = multiplyMatrices(translationMatrix(20, -5), scaleMatrix(2));
    expect(transformPoint(moved, { x: 3, y: 4 })).toEqual({ x: 26, y: 3 });
  });

  test("round-trips points through an inverse matrix", () => {
    const matrix = multiplyMatrices(translationMatrix(40, 30), rotationMatrix(35));
    const inverse = invertMatrix(matrix)!;
    const point = { x: 12, y: -8 };
    const roundTrip = transformPoint(inverse, transformPoint(matrix, point));
    expect(roundTrip.x).toBeCloseTo(point.x);
    expect(roundTrip.y).toBeCloseTo(point.y);
  });

  test("scales around a fixed screen-space center", () => {
    const aroundCenter = transformAroundPoint(scaleMatrix(2), { x: 100, y: 50 });
    expect(transformPoint(aroundCenter, { x: 100, y: 50 })).toEqual({ x: 100, y: 50 });
    expect(transformPoint(aroundCenter, { x: 110, y: 60 })).toEqual({ x: 120, y: 70 });
  });

  test("keeps the opposite side fixed for every resize handle", () => {
    const cases = [
      {
        handle: "resize-nw",
        start: { x: 0, y: 0 },
        pointer: { x: -20, y: -10 },
        anchor: { x: 100, y: 50 },
        dragged: { x: -20, y: -10 },
      },
      {
        handle: "resize-n",
        start: { x: 50, y: 0 },
        pointer: { x: 70, y: -10 },
        anchor: { x: 50, y: 50 },
        dragged: { x: 50, y: -10 },
      },
      {
        handle: "resize-ne",
        start: { x: 100, y: 0 },
        pointer: { x: 120, y: -10 },
        anchor: { x: 0, y: 50 },
        dragged: { x: 120, y: -10 },
      },
      {
        handle: "resize-e",
        start: { x: 100, y: 25 },
        pointer: { x: 120, y: 35 },
        anchor: { x: 0, y: 25 },
        dragged: { x: 120, y: 25 },
      },
      {
        handle: "resize-se",
        start: { x: 100, y: 50 },
        pointer: { x: 120, y: 60 },
        anchor: { x: 0, y: 0 },
        dragged: { x: 120, y: 60 },
      },
      {
        handle: "resize-s",
        start: { x: 50, y: 50 },
        pointer: { x: 70, y: 60 },
        anchor: { x: 50, y: 0 },
        dragged: { x: 50, y: 60 },
      },
      {
        handle: "resize-sw",
        start: { x: 0, y: 50 },
        pointer: { x: -20, y: 60 },
        anchor: { x: 100, y: 0 },
        dragged: { x: -20, y: 60 },
      },
      {
        handle: "resize-w",
        start: { x: 0, y: 25 },
        pointer: { x: -20, y: 35 },
        anchor: { x: 100, y: 25 },
        dragged: { x: -20, y: 25 },
      },
    ] as const;

    for (const resize of cases) {
      const transform = resizeSelectionTransform({ frame: FRAME, ...resize })!;
      expectPoint(transformPoint(transform, resize.anchor), resize.anchor);
      expectPoint(transformPoint(transform, resize.start), resize.dragged);
    }
  });

  test("resizes around the center and preserves aspect ratio on demand", () => {
    const fromCenter = resizeSelectionTransform({
      frame: FRAME,
      handle: "resize-se",
      start: { x: 100, y: 50 },
      pointer: { x: 150, y: 75 },
      fromCenter: true,
    })!;
    expectPoint(transformPoint(fromCenter, FRAME.center), FRAME.center);
    expectPoint(transformPoint(fromCenter, { x: 100, y: 50 }), { x: 150, y: 75 });
    expectPoint(transformPoint(fromCenter, { x: 0, y: 0 }), { x: -50, y: -25 });

    const constrained = resizeSelectionTransform({
      frame: FRAME,
      handle: "resize-se",
      start: { x: 100, y: 50 },
      pointer: { x: 150, y: 50 },
      preserveAspectRatio: true,
    })!;
    expectPoint(transformPoint(constrained, { x: 100, y: 50 }), { x: 150, y: 75 });
  });

  test("resizes in an oriented frame and clamps before crossing the anchor", () => {
    const rotatedFrame = {
      corners: [
        { x: 100, y: 20 },
        { x: 100, y: 120 },
        { x: 50, y: 120 },
        { x: 50, y: 20 },
      ],
      center: { x: 75, y: 70 },
    } as const;
    const oriented = resizeSelectionTransform({
      frame: rotatedFrame,
      handle: "resize-ne",
      start: { x: 100, y: 120 },
      pointer: { x: 100, y: 220 },
    })!;
    expectPoint(transformPoint(oriented, { x: 50, y: 20 }), { x: 50, y: 20 });
    expectPoint(transformPoint(oriented, { x: 100, y: 120 }), { x: 100, y: 220 });

    const clamped = resizeSelectionTransform({
      frame: FRAME,
      handle: "resize-se",
      start: { x: 100, y: 50 },
      pointer: { x: -100, y: -100 },
    })!;
    expectPoint(transformPoint(clamped, { x: 100, y: 50 }), { x: 5, y: 2.5 });
  });

  test("preserves the grab offset and snaps rotation deltas", () => {
    const resized = resizeSelectionTransform({
      frame: FRAME,
      handle: "resize-w",
      start: { x: 4, y: 27 },
      pointer: { x: -46, y: 37 },
    })!;
    expectPoint(transformPoint(resized, { x: 0, y: 25 }), { x: -50, y: 25 });

    const angle = (22 * Math.PI) / 180;
    const rotated = rotateSelectionTransform({
      center: { x: 0, y: 0 },
      start: { x: 10, y: 0 },
      pointer: { x: Math.cos(angle) * 10, y: Math.sin(angle) * 10 },
      snap: true,
    });
    expect(serializeMatrix(rotated)).toBe(serializeMatrix(rotationMatrix(15)));
  });

  test("serializes stable SVG matrix attributes", () => {
    expect(serializeMatrix(rotationMatrix(90))).toBe("matrix(0 1 -1 0 0 0)");
  });
});

function expectPoint(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
}
