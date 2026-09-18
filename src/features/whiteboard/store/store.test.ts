import { describe, expect, test } from "bun:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SvgDocument } from "../document";
import { createChildrenHistoryEntry } from "../document/history";
import { createEditorStore } from "./store";

const parser = new DOMParser() as unknown as globalThis.DOMParser;
const serializer = new XMLSerializer() as unknown as globalThis.XMLSerializer;

function createEditor() {
  const document = new SvgDocument({ parser, serializer });
  document.load('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" />');
  return { document, editor: createEditorStore(document, false) };
}

describe("SVG editor state", () => {
  test("keeps one concrete active tool and retained style defaults", () => {
    const { editor } = createEditor();

    editor.actions.activateTool("line");
    editor.actions.changeStyle({ property: "color", value: "#ef4444" });
    editor.actions.activateTool("hand");

    expect(editor.state.activeTool).toBe("hand");
    expect(editor.state.styleDefaults.color).toBe("#ef4444");
  });

  test("tracks semantic gesture transitions", () => {
    const { editor } = createEditor();
    editor.actions.beginGesture({ type: "pending-move" });

    expect(editor.state.gesture).toEqual({ type: "pending-move" });
    editor.actions.updateGesture({ type: "transform", mode: "move" });
    expect(editor.state.gesture).toEqual({ type: "transform", mode: "move" });
    editor.actions.endGesture();
    expect(editor.state.gesture).toBeNull();
  });

  test("activates the select tool when elements are selected", () => {
    const { document, editor } = createEditor();
    const rectangle = document.root.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    ) as unknown as SVGGraphicsElement;
    document.root.appendChild(rectangle);

    editor.actions.select([rectangle]);

    expect(editor.state.activeTool).toBe("select");
    expect(editor.state.selection).toEqual([rectangle]);
  });

  test("keeps only top-level elements when a group and its descendant are selected", () => {
    const { document, editor } = createEditor();
    const group = document.root.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    ) as unknown as SVGGraphicsElement;
    const rectangle = document.root.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    ) as unknown as SVGGraphicsElement;
    group.appendChild(rectangle);
    document.root.appendChild(group);

    editor.actions.select([rectangle, group, rectangle]);

    expect(editor.state.selection).toEqual([group]);
  });

  test("owns centered viewport zoom transitions", () => {
    const { editor } = createEditor();
    editor.actions.resizeViewport({ width: 800, height: 600 });
    const before = editor.state.viewport;

    editor.actions.zoomIn();

    expect(editor.state.viewport.mode).toEqual({ type: "manual" });
    expect(editor.state.viewport.zoom).toBeGreaterThan(before.zoom);
    editor.actions.zoomOut();
    expect(editor.state.viewport.zoom).toBeCloseTo(before.zoom);
  });

  test("owns point-centered zoom and viewport-space panning", () => {
    const { editor } = createEditor();
    editor.actions.resizeViewport({ width: 800, height: 600 });
    const viewportPoint = { x: 100, y: 150 };
    const before = editor.state.viewport;
    const documentPoint = {
      x: viewportPoint.x / before.zoom - before.panX,
      y: viewportPoint.y / before.zoom - before.panY,
    };

    editor.actions.zoomAt("in", viewportPoint);
    const zoomed = editor.state.viewport;
    expect(viewportPoint.x / zoomed.zoom - zoomed.panX).toBeCloseTo(documentPoint.x);
    expect(viewportPoint.y / zoomed.zoom - zoomed.panY).toBeCloseTo(documentPoint.y);

    editor.actions.panBy({ x: 11, y: -22 });
    expect(editor.state.viewport.panX).toBeCloseTo(zoomed.panX + 11 / zoomed.zoom);
    expect(editor.state.viewport.panY).toBeCloseTo(zoomed.panY - 22 / zoomed.zoom);
  });

  test("fits content and places inserted images through the current viewport", () => {
    const { document, editor } = createEditor();
    editor.actions.resizeViewport({ width: 800, height: 600 });

    editor.actions.fitContent();
    expect(editor.state.viewport.mode.type).toBe("fit-bounds");
    expect(editor.state.viewport.zoom).toBeCloseTo(5.4);

    expect(
      editor.actions.insertImage("data:image/png;base64,AA==", { width: 1_000, height: 500 }),
    ).toBe(true);
    expect(document.root.getElementsByTagName("image")).toHaveLength(1);
    expect(editor.state.activeTool).toBe("select");
    expect(editor.state.selection).toHaveLength(1);
    expect(editor.state.history.undoStack).toHaveLength(1);
    expect(editor.state.viewport.zoom).toBeLessThanOrEqual(1);
  });

  test("applies style to a selection without replacing future drawing defaults", () => {
    const { document, editor } = createEditor();
    const rectangle = document.root.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    ) as unknown as SVGGraphicsElement;
    rectangle.setAttribute("stroke", "black");
    document.root.appendChild(rectangle);
    editor.actions.activateTool("select");
    editor.actions.select([rectangle]);

    editor.actions.changeStyle({ property: "color", value: "purple" });

    expect(rectangle.getAttribute("stroke")).toBe("purple");
    expect(editor.state.styleDefaults.color).toBeNull();
    expect(editor.state.history.undoStack).toHaveLength(1);
  });

  test("owns native DOM history and clears DOM-backed state when the document changes", () => {
    const { document, editor } = createEditor();
    const rectangle = document.root.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    ) as unknown as SVGGraphicsElement;
    const before = Array.from(document.root.childNodes);
    document.root.appendChild(rectangle);
    editor.actions.commit(
      createChildrenHistoryEntry(document.root, before, Array.from(document.root.childNodes)),
    );
    editor.actions.select([rectangle]);

    expect(editor.state.history.undoStack).toHaveLength(1);
    editor.actions.undo();
    expect(document.root.getElementsByTagName("rect")).toHaveLength(0);
    expect(editor.state.selection).toHaveLength(0);

    editor.actions.loadDocument(
      '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="5" /></svg>',
    );
    expect(document.root.getElementsByTagName("circle")).toHaveLength(1);
    expect(editor.state.history.undoStack).toHaveLength(0);
    expect(editor.state.gesture).toBeNull();
    expect(editor.state.selection).toHaveLength(0);
  });

  test("removes a selection and clears the document as atomic editor commands", () => {
    const { document, editor } = createEditor();
    const first = document.root.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    ) as unknown as SVGGraphicsElement;
    const second = document.root.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    ) as unknown as SVGGraphicsElement;
    document.root.appendChild(first);
    document.root.appendChild(second);
    editor.actions.select([first]);

    expect(editor.actions.removeSelection()).toBe(true);
    expect(document.root.getElementsByTagName("rect")).toHaveLength(0);
    expect(editor.state.selection).toHaveLength(0);
    expect(editor.state.history.undoStack).toHaveLength(1);

    editor.actions.select([second]);
    expect(editor.actions.clear()).toBe(true);
    expect(document.getSnapshot().isEmpty).toBe(true);
    expect(editor.state.selection).toHaveLength(0);
    expect(editor.state.history.undoStack).toHaveLength(2);
  });
});
