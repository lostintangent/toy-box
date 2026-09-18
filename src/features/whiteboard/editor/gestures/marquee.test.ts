import { describe, expect, test } from "bun:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SvgDocument } from "../../document";
import { createEditorStore } from "../../store";
import { marqueeRect, startMarqueeGesture } from "./marquee";

const parser = new DOMParser() as unknown as globalThis.DOMParser;
const serializer = new XMLSerializer() as unknown as globalThis.XMLSerializer;

function createEditor() {
  const document = new SvgDocument({ parser, serializer });
  document.load('<svg xmlns="http://www.w3.org/2000/svg" />');
  return { document, store: createEditorStore(document, false) };
}

function pointer(x: number, y: number) {
  return {
    clientX: x,
    clientY: y,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    },
  } as React.PointerEvent<HTMLDivElement>;
}

describe("SVG marquee gestures", () => {
  test("normalizes marquee geometry and selects enclosed elements", () => {
    expect(marqueeRect({ x: 20, y: 40 }, { x: 5, y: 60 })).toEqual({
      x: 5,
      y: 40,
      width: 15,
      height: 20,
    });

    const { store } = createEditor();
    const additive = screenElement({ x: 200, y: 200, width: 10, height: 10 });
    const inside = screenElement({ x: 10, y: 10, width: 10, height: 10 });
    const crossing = screenElement({ x: 25, y: 25, width: 10, height: 10 });
    let selection: readonly SVGGraphicsElement[] = [];
    const gesture = startMarqueeGesture({
      document: { listSelectionCandidates: () => [inside, crossing] },
      store,
      start: { x: 0, y: 0 },
      additiveSelection: [additive],
      select: (elements) => {
        selection = elements;
      },
    })!;

    gesture.update(pointer(30, 30));

    expect(store.state.gesture).toEqual({
      type: "marquee",
      rect: { x: 0, y: 0, width: 30, height: 30 },
    });
    expect(selection).toEqual([additive, inside]);
  });
});

function screenElement(bounds: { x: number; y: number; width: number; height: number }) {
  return {
    localName: "rect",
    getBBox: () => bounds,
    getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  } as unknown as SVGGraphicsElement;
}
