import { describe, expect, test } from "bun:test";
import { framePosition, measurePinch, UNZOOMED, zoomBy } from "./useScreenPointer";

test("pointers map to frame fractions through letterboxing and zoom, and miss off the frame", () => {
  const bounds = { left: 10, top: 20, width: 1000, height: 1000 };
  const frame = { width: 1600, height: 1000 };
  expect(framePosition(bounds, frame, 510, 520)).toEqual({ x: 0.5, y: 0.5 });
  expect(framePosition(bounds, frame, 10, 20)).toBeUndefined();
  expect(framePosition(bounds, frame, 1011, 520)).toBeUndefined();
  expect(framePosition({ ...bounds, width: 0 }, frame, 10, 20)).toBeUndefined();
  const zoomed = { left: -260, top: -720, width: 1200, height: 2400 };
  expect(framePosition(zoomed, frame, 40, 292.5)).toEqual({ x: 0.25, y: 0.25 });
});

describe("local zoom", () => {
  test("one pointer measures a pan, and two measure a pinch", () => {
    expect(measurePinch([])).toBeUndefined();
    expect(measurePinch([{ x: 20, y: 30 }])).toEqual({ center: { x: 20, y: 30 }, distance: 0 });
    expect(
      measurePinch([
        { x: -30, y: -40 },
        { x: 30, y: 40 },
      ]),
    ).toEqual({ center: { x: 0, y: 0 }, distance: 100 });
  });

  test("the frame point under a step's origin lands under its target", () => {
    const next = zoomBy(
      UNZOOMED,
      { factor: 2, from: { x: 20, y: 10 }, to: { x: 30, y: 20 } },
      { width: 200, height: 200 },
      { width: 800, height: 800 },
    );
    expect(next).toEqual({ scale: 2, x: -10, y: 0 });
    expect((30 - next.x) / next.scale).toBe(20);
    expect((20 - next.y) / next.scale).toBe(10);
  });

  test("panning stops at the frame's edges rather than the letterboxed canvas's", () => {
    expect(
      zoomBy(
        { scale: 2, x: 0, y: 0 },
        { factor: 1, from: { x: 0, y: 0 }, to: { x: 1000, y: -1000 } },
        { width: 400, height: 800 },
        { width: 1600, height: 1000 },
      ),
    ).toEqual({ scale: 2, x: 200, y: 0 });
  });

  test("zoom stays between fitted and the largest frame's pixels, whatever size frames are", () => {
    const center = { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };
    const pane = { width: 400, height: 800 };
    const zoomed = { scale: 9.6, x: 0, y: 0 };
    expect(
      zoomBy(UNZOOMED, { ...center, factor: 0.1 }, pane, { width: 1600, height: 1000 }),
    ).toEqual(UNZOOMED);
    expect(
      zoomBy(UNZOOMED, { ...center, factor: 20 }, pane, { width: 1600, height: 1000 }),
    ).toEqual(zoomed);
    expect(zoomBy(UNZOOMED, { ...center, factor: 20 }, pane, { width: 400, height: 250 })).toEqual(
      zoomed,
    );
  });

  test("a step that doesn't scale keeps the zoom's scale and pans", () => {
    expect(
      zoomBy(
        { scale: 3, x: 40, y: 10 },
        { factor: 1, from: { x: 30, y: 20 }, to: { x: 50, y: 10 } },
        { width: 200, height: 200 },
        { width: 800, height: 800 },
      ),
    ).toEqual({ scale: 3, x: 60, y: 0 });
  });
});
