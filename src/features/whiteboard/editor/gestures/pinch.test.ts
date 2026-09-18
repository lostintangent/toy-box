import { describe, expect, test } from "bun:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SvgDocument } from "../../document";
import { createEditorStore, toDocumentPoint } from "../../store";
import { startPinchGesture } from "./pinch";

const parser = new DOMParser() as unknown as globalThis.DOMParser;
const serializer = new XMLSerializer() as unknown as globalThis.XMLSerializer;

describe("SVG pinch gestures", () => {
  test("keeps the initial midpoint's document point under the moving touch midpoint", () => {
    const document = new SvgDocument({ parser, serializer });
    document.load('<svg xmlns="http://www.w3.org/2000/svg" />');
    const store = createEditorStore(document, false);
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
});
