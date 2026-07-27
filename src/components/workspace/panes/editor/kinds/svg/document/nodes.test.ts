import { describe, expect, test } from "bun:test";
import { DOMParser } from "@xmldom/xmldom";
import {
  createSvgEraserNodes,
  createSvgShape,
  pointsToPathData,
  resolveSvgFillPattern,
} from "./nodes";

const parser = new DOMParser();

function createRoot(): SVGSVGElement {
  return parser.parseFromString(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" />',
    "image/svg+xml",
  ).documentElement as unknown as SVGSVGElement;
}

describe("SVG node construction", () => {
  test("writes ordinary path data that agents and SVG tools can edit", () => {
    expect(
      pointsToPathData([
        { x: 10, y: 20 },
        { x: 30.1254, y: 40.5678 },
      ]),
    ).toBe("M10 20 L30.125 40.568");
  });

  test("creates native shapes and definition candidates without mutating the document tree", () => {
    const root = createRoot();
    const line = createSvgShape(
      root,
      "line",
      { x: 10, y: 20 },
      { x: 100, y: 120 },
      { color: "#ef4444", width: 4 },
    );
    const arrow = createSvgShape(
      root,
      "arrow",
      { x: 10, y: 20 },
      { x: 100, y: 120 },
      { color: "#ef4444", width: 4 },
    );
    const box = createSvgShape(
      root,
      "rectangle",
      { x: 20, y: 30 },
      { x: 220, y: 130 },
      { color: "#111827", width: 2, fill: { color: "#38bdf8", style: "dots" } },
    );

    expect(line.element.getAttribute("stroke-linecap")).toBe("butt");
    expect(arrow.element.getAttribute("marker-end")).toBe("url(#toybox-arrow)");
    expect(arrow.definitions).toHaveLength(1);
    expect(arrow.definitions[0]?.getElementsByTagName("polyline")[0]?.getAttribute("stroke")).toBe(
      "context-stroke",
    );
    expect(box.element.getAttribute("fill")).toBe("url(#toybox-fill-dots-38bdf8)");
    expect(box.definitions).toHaveLength(1);
    expect(root.children).toHaveLength(0);
  });

  test("reuses definitions that are already attached to the document", () => {
    const root = createRoot();
    const first = resolveSvgFillPattern(root, "dots", "#38bdf8");
    expect(first.definition).not.toBeNull();
    const defs = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.appendChild(first.definition!);
    root.appendChild(defs);

    expect(resolveSvgFillPattern(root, "dots", "#38bdf8")).toEqual({
      id: first.id,
      definition: null,
    });
  });

  test("creates a self-sizing eraser mask with stable page geometry", () => {
    const root = createRoot();
    const nodes = createSvgEraserNodes(
      root,
      { x: 0, y: 0, width: 800, height: 600 },
      [{ x: 20, y: 30 }],
      16,
    );

    expect(nodes.mask.parentNode).toBeNull();
    expect(nodes.mask.getAttribute("maskUnits")).toBe("objectBoundingBox");
    expect(nodes.mask.getAttribute("maskContentUnits")).toBe("userSpaceOnUse");
    expect(nodes.path.getAttribute("data-toybox-eraser-path")).toBe("");
    expect(nodes.path.getAttribute("d")).toBe("M20 30");
    expect(nodes.maskedContent.getAttribute("data-toybox-eraser-layer")).toBe("");
    expect(nodes.mask.children[0]?.getAttribute("x")).toBe("-800000");
    expect(nodes.mask.children[0]?.getAttribute("width")).toBe("1600800");
    expect(nodes.maskedContent.children[0]?.getAttribute("data-toybox-eraser-bounds")).toBe("");
    expect(nodes.maskedContent.children[0]?.getAttribute("width")).toBe("800");
    expect(root.children).toHaveLength(0);
  });
});
