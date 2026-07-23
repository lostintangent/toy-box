import { describe, expect, test } from "bun:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SvgDocument } from "../../document";
import { createEditorStore, type Tool } from "../../store";
import { createDrawingGestureSource } from "../drawing/source";
import type { GestureController, GestureOutcome } from "./gesture";

function createDocument(
  source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" />',
) {
  const parser = new DOMParser() as unknown as globalThis.DOMParser;
  const serializer = new XMLSerializer() as unknown as globalThis.XMLSerializer;
  const document = new SvgDocument({
    parser,
    serializer,
  });
  document.load(source);
  return document;
}

function createDrawing(tool: Exclude<Tool, "hand" | "select" | "text">, source?: string) {
  const document = createDocument(source);
  const store = createEditorStore(document, false);
  store.actions.activateTool(tool);
  store.actions.changeStyle({ property: "color", value: "purple" });
  store.actions.changeStyle({ property: "strokeWidth", value: 4 });
  return {
    document,
    store,
    source: createDrawingGestureSource({
      document,
      store,
      themeForegroundColor: "black",
    }),
  };
}

function pointer(x: number, y: number) {
  return {
    clientX: x,
    clientY: y,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    },
    preventDefault() {},
  } as React.PointerEvent<HTMLDivElement>;
}

function finish(
  store: ReturnType<typeof createEditorStore>,
  gesture: GestureController<React.PointerEvent<HTMLDivElement>>,
  outcome: GestureOutcome,
) {
  gesture.finish(outcome);
  store.actions.endGesture();
}

describe("SVG drawing gestures", () => {
  test("mutates a provisional native path before committing one reversible edit", () => {
    const { document, store, source } = createDrawing("pen");
    const drawing = source.claim(pointer(10, 20))!;
    const path = document.root.getElementsByTagName("path")[0]!;

    expect(path.getAttribute("d")).toBe("M10 20");
    drawing.update(pointer(30, 40));
    expect(path.getAttribute("d")).toBe("M10 20 L30 40");

    finish(store, drawing, "commit");
    expect(store.state.history.undoStack).toHaveLength(1);
    store.actions.undo();
    expect(document.root.getElementsByTagName("path")).toHaveLength(0);
    store.actions.redo();
    expect(document.root.getElementsByTagName("path")[0]?.getAttribute("d")).toBe("M10 20 L30 40");
  });

  test("rolls back a cancelled or undersized provisional shape", () => {
    const rectangle = createDrawing("rectangle");
    const cancelled = rectangle.source.claim(pointer(10, 20))!;
    cancelled.update(pointer(50, 60));
    expect(rectangle.document.root.getElementsByTagName("rect")).toHaveLength(1);
    finish(rectangle.store, cancelled, "cancel");
    expect(rectangle.document.root.getElementsByTagName("rect")).toHaveLength(0);

    const line = createDrawing("line");
    const undersized = line.source.claim(pointer(10, 20))!;
    undersized.update(pointer(12, 22));
    finish(line.store, undersized, "commit");
    expect(line.store.state.history.undoStack).toHaveLength(0);
    expect(line.document.root.getElementsByTagName("line")).toHaveLength(0);
  });

  test("renders shape fills from the native SVG node as soon as drawing begins", () => {
    const { document, store, source } = createDrawing("rectangle");
    store.actions.changeStyle({
      property: "fill",
      value: { color: "orange", style: "solid" },
    });
    const drawing = source.claim(pointer(10, 20))!;
    const rectangle = document.root.getElementsByTagName("rect")[0]!;

    expect(rectangle.getAttribute("fill")).toBe("orange");
    drawing.update(pointer(50, 60));
    expect(document.root.getElementsByTagName("rect")).toHaveLength(1);
    finish(store, drawing, "commit");
  });

  test("updates the real eraser path live and restores the exact tree on cancellation", () => {
    const { document, store, source } = createDrawing(
      "eraser",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" /></svg>',
    );
    const original = document.serialize().content;
    const drawing = source.claim(pointer(10, 20))!;
    const eraser = Array.from(document.root.getElementsByTagName("path")).find((path) =>
      path.hasAttribute("data-toybox-eraser-path"),
    )!;

    expect(document.root.getElementsByTagName("mask")).toHaveLength(1);
    drawing.update(pointer(30, 40));
    expect(eraser.getAttribute("d")).toBe("M10 20 L30 40");

    finish(store, drawing, "cancel");
    expect(document.serialize().content).toBe(original);
  });

  test("commits live erasing as one exact history entry", () => {
    const { document, store, source } = createDrawing(
      "eraser",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" /></svg>',
    );
    const original = document.serialize().content;
    const drawing = source.claim(pointer(10, 20))!;
    drawing.update(pointer(30, 40));

    finish(store, drawing, "commit");
    const erased = document.serialize().content;
    store.actions.undo();
    expect(document.serialize().content).toBe(original);
    store.actions.redo();
    expect(document.serialize().content).toBe(erased);
  });
});
