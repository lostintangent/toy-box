import { describe, expect, test } from "bun:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SvgDocument } from ".";
import { applyHistoryEntry } from "./history";
import { createSvgEraserNodes, createSvgPath, createSvgShape } from "./nodes";

const parser = new DOMParser() as unknown as globalThis.DOMParser;
const serializer = new XMLSerializer() as unknown as globalThis.XMLSerializer;

function createSvgDocument() {
  return new SvgDocument({ parser, serializer });
}

function appendPath(
  document: SvgDocument,
  points: { x: number; y: number }[],
  style: { color: string; width: number },
) {
  return document.appendElement(createSvgPath(document.root, points, style));
}

function erase(document: SvgDocument, points: { x: number; y: number }[], width: number) {
  return document.eraseVisibleContent(
    createSvgEraserNodes(document.root, document.page, points, width),
  );
}

describe("SVG document", () => {
  test("exposes the document root through the lifecycle snapshot", () => {
    const svgDocument = createSvgDocument();

    expect(svgDocument.getSnapshot().root).toBeNull();
    svgDocument.load('<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>');
    expect(svgDocument.getSnapshot().root).toBe(svgDocument.root);
  });

  test("clears the previous document when replacement source is invalid", () => {
    const svgDocument = createSvgDocument();
    svgDocument.load('<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>');
    svgDocument.load("<svg>");

    expect(svgDocument.getSnapshot().root).toBeNull();
    expect(svgDocument.getSnapshot().error).toBeString();
  });

  test("derives the editor page from viewBox, then numeric dimensions, then a stable default", () => {
    const pageOf = (source: string) => {
      const svgDocument = createSvgDocument();
      svgDocument.load(source);
      return svgDocument.page;
    };

    expect(pageOf('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 10 640 360" />')).toEqual({
      x: -20,
      y: 10,
      width: 640,
      height: 360,
    });
    expect(
      pageOf('<svg xmlns="http://www.w3.org/2000/svg" width="1024px" height="768" />'),
    ).toEqual({ x: 0, y: 0, width: 1024, height: 768 });
    expect(pageOf('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" />')).toEqual(
      { x: 0, y: 0, width: 800, height: 600 },
    );
  });

  test("serializes the rich authoritative DOM without editor-only wrappers", () => {
    const svgDocument = createSvgDocument();
    svgDocument.load(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><linearGradient id="g"><stop stop-color="red" /></linearGradient></defs>
  <path id="wave" d="M0 50C20 0 80 100 100 50" stroke="url(#g)" />
</svg>`);

    expect(svgDocument.getSnapshot().error).toBeNull();
    expect(svgDocument.serialize().content).toContain('<linearGradient id="g">');
    expect(svgDocument.serialize().content).not.toContain("toybox-editor");
  });

  test("renders the editor viewport without replacing the document's authored viewBox", () => {
    const svgDocument = createSvgDocument();
    svgDocument.load(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><rect /></svg>',
    );

    svgDocument.setRenderedViewport({ x: -100, y: -250, width: 750, height: 1_000 });

    expect(svgDocument.root.getAttribute("viewBox")).toBe("-100 -250 750 1000");
    expect(svgDocument.serialize().content).toContain('viewBox="0 0 1200 800"');
  });

  test("does not serialize a runtime viewBox into a document that did not author one", () => {
    const svgDocument = createSvgDocument();
    svgDocument.load('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" />');

    svgDocument.setRenderedViewport({ x: 10, y: 20, width: 400, height: 300 });

    expect(svgDocument.root.getAttribute("viewBox")).toBe("10 20 400 300");
    expect(svgDocument.serialize().content).not.toContain("viewBox");
  });

  test("treats named groups as authored objects and structural groups as transparent", () => {
    const svgDocument = createSvgDocument();
    svgDocument.load(`<svg xmlns="http://www.w3.org/2000/svg">
  <defs><path id="hidden" d="M0 0" /></defs>
  <g id="cloud"><circle id="cloud-part" /></g>
  <g><rect id="box" /></g>
</svg>`);
    const root = svgDocument.root;
    const circle = root.getElementsByTagName("circle")[0] as unknown as EventTarget;
    const cloud = root.getElementsByTagName("g")[0] as unknown as SVGGraphicsElement;
    const structuralGroup = root.getElementsByTagName("g")[1] as unknown as EventTarget;
    const box = root.getElementsByTagName("rect")[0] as unknown as SVGGraphicsElement;

    expect(svgDocument.resolveSelectionTarget([circle, cloud as EventTarget, root])).toBe(cloud);
    expect(svgDocument.resolveSelectionTarget([box as EventTarget, structuralGroup, root])).toBe(
      box,
    );
    expect(
      svgDocument.listSelectionCandidates().map((element) => element.getAttribute("id")),
    ).toEqual(["cloud", "box"]);
  });

  test("gives editable text priority over its containing semantic group", () => {
    const svgDocument = createSvgDocument();
    svgDocument.load(`<svg xmlns="http://www.w3.org/2000/svg">
  <g id="label"><text fill="purple">Original label</text></g>
</svg>`);
    const root = svgDocument.root;
    const group = root.getElementsByTagName("g")[0] as unknown as EventTarget;
    const label = root.getElementsByTagName("text")[0] as unknown as SVGTextElement;

    expect(svgDocument.resolveSelectionTarget([label as EventTarget, group, root])).toBe(label);
  });

  test("adds, deletes, and clears visible nodes through reversible history entries", () => {
    const svgDocument = createSvgDocument();
    svgDocument.load(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><marker id="m" /></defs><rect id="box" /></svg>',
    );
    const circle = svgDocument.root.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    circle.setAttribute("id", "dot");
    const addition = svgDocument.appendElement(circle);
    expect(svgDocument.root.getElementsByTagName("circle")).toHaveLength(1);
    applyHistoryEntry(addition, "undo");
    expect(svgDocument.root.getElementsByTagName("circle")).toHaveLength(0);
    applyHistoryEntry(addition, "redo");

    const deletion = svgDocument.deleteElements([circle])!;
    expect(svgDocument.root.getElementsByTagName("circle")).toHaveLength(0);
    applyHistoryEntry(deletion, "undo");
    expect(svgDocument.root.getElementsByTagName("circle")).toHaveLength(1);

    const clear = svgDocument.clearVisibleContent()!;
    expect(svgDocument.listSelectionCandidates()).toHaveLength(0);
    expect(svgDocument.root.getElementsByTagName("marker")).toHaveLength(1);
    applyHistoryEntry(clear, "undo");
    expect(svgDocument.listSelectionCandidates()).toHaveLength(2);
  });

  test("returns a reversible edit and publishes the native DOM on request", () => {
    const svgDocument = createSvgDocument();
    const sources: string[] = [];
    svgDocument.subscribeToSource((source) => sources.push(source));
    svgDocument.load('<svg xmlns="http://www.w3.org/2000/svg" />');
    expect(svgDocument.getSnapshot().isEmpty).toBe(true);

    const entry = appendPath(
      svgDocument,
      [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ],
      { color: "blue", width: 4 },
    );
    expect(svgDocument.getSnapshot().isEmpty).toBe(true);
    expect(svgDocument.publishSource()).toBe(true);
    expect(svgDocument.getSnapshot().isEmpty).toBe(false);
    expect(sources.at(-1)).toContain("<path");

    applyHistoryEntry(entry, "undo");
    svgDocument.publishSource();
    expect(svgDocument.getSnapshot().isEmpty).toBe(true);
    expect(svgDocument.root.getElementsByTagName("path")).toHaveLength(0);

    applyHistoryEntry(entry, "redo");
    svgDocument.publishSource();
    expect(svgDocument.getSnapshot().isEmpty).toBe(false);
    expect(svgDocument.root.getElementsByTagName("path")).toHaveLength(1);
  });

  test("attaches detached definitions and their element as one history entry", () => {
    const svgDocument = createSvgDocument();
    svgDocument.load('<svg xmlns="http://www.w3.org/2000/svg" />');
    const arrow = createSvgShape(
      svgDocument.root,
      "arrow",
      { x: 10, y: 20 },
      { x: 100, y: 120 },
      { color: "#ef4444", width: 4 },
    );

    const entry = svgDocument.appendElement(arrow.element, arrow.definitions);
    expect(svgDocument.root.getElementsByTagName("marker")).toHaveLength(1);
    expect(svgDocument.root.getElementsByTagName("line")).toHaveLength(1);

    applyHistoryEntry(entry, "undo");
    expect(svgDocument.root.getElementsByTagName("marker")).toHaveLength(0);
    expect(svgDocument.root.getElementsByTagName("line")).toHaveLength(0);

    applyHistoryEntry(entry, "redo");
    expect(svgDocument.root.getElementsByTagName("marker")).toHaveLength(1);
    expect(svgDocument.root.getElementsByTagName("line")).toHaveLength(1);
  });

  test("erases renderable content without relocating document definitions", () => {
    const svgDocument = createSvgDocument();
    svgDocument.load(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
  <defs><linearGradient id="paint"><stop stop-color="red" /></linearGradient></defs>
  <style>.box { fill: url(#paint); }</style>
  <clipPath id="clip"><circle cx="50" cy="50" r="40" /></clipPath>
  <g id="scene"><rect id="box" class="box" clip-path="url(#clip)" /></g>
</svg>`);
    const original = svgDocument.serialize().content;

    const entry = erase(
      svgDocument,
      [
        { x: 20, y: 30 },
        { x: 80, y: 90 },
      ],
      16,
    )!;

    const root = svgDocument.root;
    const mask = root.getElementsByTagName("mask")[0]!;
    const maskedContent = Array.from(root.children).find((element) =>
      element.getAttribute("mask")?.includes("toybox-eraser-mask"),
    )!;
    expect(mask.parentElement?.localName).toBe("defs");
    expect(root.getElementsByTagName("style")[0]?.parentNode === root).toBe(true);
    expect(root.getElementsByTagName("clipPath")[0]?.parentNode === root).toBe(true);
    expect(root.getElementsByTagName("linearGradient")[0]?.parentElement?.localName).toBe("defs");
    const scene = Array.from(root.getElementsByTagName("g")).find(
      (element) => element.getAttribute("id") === "scene",
    );
    expect(scene?.parentNode === maskedContent).toBe(true);
    const erased = svgDocument.serialize().content;

    applyHistoryEntry(entry, "undo");
    expect(svgDocument.serialize().content).toBe(original);

    applyHistoryEntry(entry, "redo");
    expect(svgDocument.serialize().content).toBe(erased);
  });

  test("keeps sequential eraser strokes as chronological native SVG layers", () => {
    const svgDocument = createSvgDocument();
    svgDocument.load(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect id="box" width="200" height="200" /></svg>',
    );
    const original = svgDocument.serialize().content;
    const first = erase(
      svgDocument,
      [
        { x: 20, y: 30 },
        { x: 80, y: 90 },
      ],
      16,
    )!;
    const afterFirst = svgDocument.serialize().content;
    const second = erase(
      svgDocument,
      [
        { x: 120, y: 130 },
        { x: 180, y: 190 },
      ],
      24,
    )!;
    const afterSecond = svgDocument.serialize().content;

    expect(svgDocument.root.getElementsByTagName("mask")).toHaveLength(2);
    applyHistoryEntry(second, "undo");
    expect(svgDocument.serialize().content).toBe(afterFirst);
    applyHistoryEntry(first, "undo");
    expect(svgDocument.serialize().content).toBe(original);

    applyHistoryEntry(first, "redo");
    expect(svgDocument.serialize().content).toBe(afterFirst);
    applyHistoryEntry(second, "redo");
    expect(svgDocument.serialize().content).toBe(afterSecond);
  });

  test("starts a new chronological eraser layer after new content is drawn", () => {
    const svgDocument = createSvgDocument();
    svgDocument.load(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="200" height="200" /></svg>',
    );
    erase(
      svgDocument,
      [
        { x: 20, y: 30 },
        { x: 80, y: 90 },
      ],
      16,
    );
    appendPath(
      svgDocument,
      [
        { x: 120, y: 130 },
        { x: 180, y: 190 },
      ],
      { color: "blue", width: 4 },
    );

    erase(
      svgDocument,
      [
        { x: 200, y: 210 },
        { x: 260, y: 270 },
      ],
      24,
    );

    expect(svgDocument.root.getElementsByTagName("mask")).toHaveLength(2);
  });

  test("reopens persisted erasing directly from the native SVG", () => {
    const svgDocument = createSvgDocument();
    svgDocument.load(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 50H100" /></svg>',
    );
    erase(
      svgDocument,
      [
        { x: 40, y: 50 },
        { x: 60, y: 50 },
      ],
      16,
    );
    const persisted = svgDocument.serialize().content ?? "";

    const reopened = createSvgDocument();
    reopened.load(persisted);

    expect(reopened.root.getElementsByTagName("mask")).toHaveLength(1);
    expect(reopened.root.getElementsByTagName("mask")[0]?.getAttribute("maskUnits")).toBe(
      "objectBoundingBox",
    );
    expect(reopened.listSelectionCandidates()).toHaveLength(1);
    expect(reopened.serialize().content).toBe(persisted);
  });

  test("validates imported clipboard markup before adopting it into the document", () => {
    const svgDocument = createSvgDocument();
    svgDocument.load('<svg xmlns="http://www.w3.org/2000/svg" />');

    const imported = svgDocument.importElements(
      '<g id="copy"><path d="M0 0C10 20 30 40 50 60" /></g>',
    );
    expect("elements" in imported && imported.elements[0]?.getAttribute("id")).toBe("copy");
    expect(
      svgDocument.importElements('<script xmlns="http://www.w3.org/2000/svg" />'),
    ).toHaveProperty("error");
  });
});
