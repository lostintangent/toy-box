import { describe, expect, test } from "bun:test";
import { SvgDocument } from "../../document";
import { createEditorStore, toDocumentPoint } from "../../store";
import { startPinchGesture } from "./pinch";

describe("SVG pinch gestures", () => {
  test("keeps the initial midpoint's document point under the moving touch midpoint", () => {
    const store = createEditorStore(new SvgDocument(), false);
    const anchoredDocumentPoint = toDocumentPoint(store.state.viewport, { x: 150, y: 100 });
    const gesture = startPinchGesture(store, [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ])!;

    gesture.update([
      { x: 140, y: 120 },
      { x: 300, y: 120 },
    ]);

    expect(store.state.gesture).toEqual({ type: "pinch" });
    expect(store.state.viewport.mode).toEqual({ type: "manual" });
    expect(store.state.viewport.zoom).toBe(1.6);
    expect(toDocumentPoint(store.state.viewport, { x: 220, y: 120 })).toEqual(
      anchoredDocumentPoint,
    );
  });

  test.each([0.01, 10])(
    "pans at the %s zoom limit without depending on which finger moves first",
    (zoom) => {
      for (const intermediate of [
        [
          { x: 120, y: 100 },
          { x: 200, y: 100 },
        ],
        [
          { x: 100, y: 100 },
          { x: 220, y: 100 },
        ],
      ] as const) {
        const store = createEditorStore(new SvgDocument(), false);
        store.actions.transformViewport(zoom, { x: 0, y: 0 }, { x: 0, y: 0 });
        const anchor = toDocumentPoint(store.state.viewport, { x: 150, y: 100 });
        const gesture = startPinchGesture(store, [
          { x: 100, y: 100 },
          { x: 200, y: 100 },
        ])!;
        gesture.update(intermediate);
        gesture.update([
          { x: 120, y: 100 },
          { x: 220, y: 100 },
        ]);

        expect(store.state.viewport.zoom).toBeCloseTo(zoom, 8);
        const movedAnchor = toDocumentPoint(store.state.viewport, { x: 170, y: 100 });
        expect(movedAnchor.x).toBeCloseTo(anchor.x, 6);
        expect(movedAnchor.y).toBeCloseTo(anchor.y, 6);
      }
    },
  );
});
