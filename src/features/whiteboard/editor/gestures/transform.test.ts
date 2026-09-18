import { describe, expect, test } from "bun:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SvgDocument } from "../../document";
import { snapshotAttribute } from "../../document/history";
import { createEditorStore } from "../../store";
import type { ElementTransformCapture } from "../selection/transform";
import { startLineEndpointGesture, startTransformGesture } from "./transform";

const parser = new DOMParser() as unknown as globalThis.DOMParser;
const serializer = new XMLSerializer() as unknown as globalThis.XMLSerializer;

function createTransform() {
  const document = new SvgDocument({ parser, serializer });
  document.load('<svg xmlns="http://www.w3.org/2000/svg" />');
  const element = document.root.ownerDocument.createElementNS(
    "http://www.w3.org/2000/svg",
    "rect",
  ) as unknown as SVGGraphicsElement;
  document.root.appendChild(element);
  return {
    document,
    element,
    store: createEditorStore(document, false),
    capture: {
      element,
      originalScreenMatrix: identityMatrix(),
      parentScreenInverse: identityMatrix(),
      beforeTransform: null,
    } satisfies ElementTransformCapture,
  };
}

function pointer(
  x: number,
  y: number,
  preventDefault = () => {},
  modifiers: { altKey?: boolean; shiftKey?: boolean } = {},
) {
  return {
    clientX: x,
    clientY: y,
    preventDefault,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  } as React.PointerEvent<HTMLDivElement>;
}

describe("SVG transform gestures", () => {
  test("moves selected elements live and commits one reversible transform", () => {
    const { element, store, capture } = createTransform();
    const gesture = startTransformGesture(store, {
      mode: "move",
      start: { x: 10, y: 20 },
      captures: [capture],
    })!;

    expect(store.state.gesture).toEqual({ type: "transform", mode: "move" });
    gesture.update(pointer(35, 15));
    expect(element.getAttribute("transform")).toBe("matrix(1 0 0 1 25 -5)");

    gesture.finish("commit");
    store.actions.endGesture();
    expect(store.state.history.undoStack).toHaveLength(1);
    store.actions.undo();
    expect(element.hasAttribute("transform")).toBe(false);
    store.actions.redo();
    expect(element.getAttribute("transform")).toBe("matrix(1 0 0 1 25 -5)");
  });

  test("keeps a click pending until movement begins and restores it on cancellation", () => {
    const { element, store, capture } = createTransform();
    let started = false;
    let prevented = false;
    const gesture = startTransformGesture(store, {
      mode: "pending-move",
      start: { x: 10, y: 10 },
      captures: [capture],
      onMoveStart: () => {
        started = true;
      },
    })!;

    gesture.update(pointer(12, 12));
    expect(store.state.gesture).toEqual({ type: "pending-move" });
    expect(element.hasAttribute("transform")).toBe(false);

    gesture.update(
      pointer(14, 13, () => {
        prevented = true;
      }),
    );
    expect(store.state.gesture).toEqual({ type: "transform", mode: "move" });
    expect(element.getAttribute("transform")).toBe("matrix(1 0 0 1 4 3)");
    expect(started).toBe(true);
    expect(prevented).toBe(true);

    gesture.finish("cancel");
    store.actions.endGesture();
    expect(element.hasAttribute("transform")).toBe(false);
    expect(store.state.history.undoStack).toHaveLength(0);
  });

  test("leaves a click unchanged when pending movement completes", () => {
    const { element, store, capture } = createTransform();
    let started = false;
    const gesture = startTransformGesture(store, {
      mode: "pending-move",
      start: { x: 10, y: 10 },
      captures: [capture],
      onMoveStart: () => {
        started = true;
      },
    })!;

    gesture.update(pointer(12, 12));
    gesture.finish("commit");
    store.actions.endGesture();

    expect(started).toBe(false);
    expect(element.hasAttribute("transform")).toBe(false);
    expect(store.state.history.undoStack).toHaveLength(0);
  });

  test("applies resize modifiers and snaps rotations", () => {
    const resized = createTransform();
    const resize = startTransformGesture(resized.store, {
      mode: "resize",
      captures: [resized.capture],
      frame: {
        corners: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 50 },
          { x: 0, y: 50 },
        ],
        center: { x: 50, y: 25 },
      },
      handle: "resize-se",
      start: { x: 100, y: 50 },
    })!;
    resize.update(pointer(150, 50, undefined, { shiftKey: true }));
    expect(resized.element.getAttribute("transform")).toBe("matrix(1.5 0 0 1.5 0 0)");
    resize.finish("cancel");
    resized.store.actions.endGesture();

    const rotated = createTransform();
    const rotate = startTransformGesture(rotated.store, {
      mode: "rotate",
      captures: [rotated.capture],
      center: { x: 0, y: 0 },
      start: { x: 10, y: 0 },
    })!;
    const angle = (22 * Math.PI) / 180;
    rotate.update(
      pointer(Math.cos(angle) * 10, Math.sin(angle) * 10, undefined, { shiftKey: true }),
    );
    expect(rotated.element.getAttribute("transform")).toBe(
      "matrix(0.965926 0.258819 -0.258819 0.965926 0 0)",
    );
    rotate.finish("cancel");
    rotated.store.actions.endGesture();
  });

  test("transforms multiple selected elements as one reversible gesture", () => {
    const transformed = createTransform();
    const second = transformed.document.root.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    ) as unknown as SVGGraphicsElement;
    transformed.document.root.appendChild(second);
    const secondCapture = {
      element: second,
      originalScreenMatrix: { a: 1, b: 0, c: 0, d: 1, e: 50, f: 25 },
      parentScreenInverse: identityMatrix(),
      beforeTransform: null,
    } satisfies ElementTransformCapture;
    const gesture = startTransformGesture(transformed.store, {
      mode: "resize",
      captures: [transformed.capture, secondCapture],
      frame: {
        corners: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 50 },
          { x: 0, y: 50 },
        ],
        center: { x: 50, y: 25 },
      },
      handle: "resize-se",
      start: { x: 100, y: 50 },
    })!;

    gesture.update(pointer(200, 100));
    expect(transformed.element.getAttribute("transform")).toBe("matrix(2 0 0 2 0 0)");
    expect(second.getAttribute("transform")).toBe("matrix(2 0 0 2 100 50)");
    gesture.finish("commit");
    transformed.store.actions.endGesture();

    expect(transformed.store.state.history.undoStack).toHaveLength(1);
    transformed.store.actions.undo();
    expect(transformed.element.hasAttribute("transform")).toBe(false);
    expect(second.hasAttribute("transform")).toBe(false);
  });

  test("edits a line endpoint as one reversible transform", () => {
    const { document, store } = createTransform();
    const line = document.root.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "line",
    ) as unknown as SVGGraphicsElement;
    line.setAttribute("x2", "10");
    line.setAttribute("y2", "20");
    document.root.appendChild(line);

    const gesture = startLineEndpointGesture({
      store,
      element: line,
      endpoint: "end",
      screenInverse: { a: 1, b: 0, c: 0, d: 1, e: -10, f: 5 },
      before: [snapshotAttribute(line, "x2"), snapshotAttribute(line, "y2")],
    })!;
    gesture.update(pointer(30, 40));
    expect(line.getAttribute("x2")).toBe("20");
    expect(line.getAttribute("y2")).toBe("45");

    gesture.finish("commit");
    store.actions.endGesture();
    expect(store.state.history.undoStack).toHaveLength(1);
    store.actions.undo();
    expect(line.getAttribute("x2")).toBe("10");
    expect(line.getAttribute("y2")).toBe("20");
    store.actions.redo();
    expect(line.getAttribute("x2")).toBe("20");
    expect(line.getAttribute("y2")).toBe("45");
  });
});

function identityMatrix() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}
