import { describe, expect, test } from "bun:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SvgDocument } from "../../document";
import { createEditorStore } from "../../store";
import { startPanGesture } from "./pan";

const parser = new DOMParser() as unknown as globalThis.DOMParser;
const serializer = new XMLSerializer() as unknown as globalThis.XMLSerializer;

function pointer(x: number, y: number, preventDefault = () => {}) {
  return { clientX: x, clientY: y, preventDefault } as React.PointerEvent<HTMLDivElement>;
}

describe("SVG pan gestures", () => {
  test("moves the viewport incrementally for the lifetime of one gesture", () => {
    const document = new SvgDocument({ parser, serializer });
    document.load('<svg xmlns="http://www.w3.org/2000/svg" />');
    const store = createEditorStore(document, false);
    let prevented = false;

    const gesture = startPanGesture(
      store,
      pointer(10, 20, () => {
        prevented = true;
      }),
    )!;
    gesture.update(pointer(25, 15));
    gesture.update(pointer(30, 25));

    expect(prevented).toBe(true);
    expect(store.state.gesture).toEqual({ type: "pan" });
    expect(store.state.viewport).toMatchObject({
      mode: { type: "manual" },
      panX: 20,
      panY: 5,
    });
  });
});
