import { describe, expect, test } from "bun:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SvgDocument } from "./document";
import { applyHistoryEntry } from "./history";
import {
  readElementStyle,
  setElementColor,
  setElementFill,
  setElementWidth,
  styleElements,
} from "./style";

const parser = new DOMParser() as unknown as globalThis.DOMParser;
const serializer = new XMLSerializer() as unknown as globalThis.XMLSerializer;

function createStyledRectangle() {
  const document = new SvgDocument({ parser, serializer });
  document.load(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red" stroke="black" stroke-width="2" /></svg>',
  );
  return {
    document,
    rectangle: document.root.getElementsByTagName("rect")[0] as unknown as SVGGraphicsElement,
  };
}

describe("SVG element styling", () => {
  test("projects and edits native SVG presentation attributes", () => {
    const { document, rectangle } = createStyledRectangle();

    expect(readElementStyle([rectangle], document.getSnapshot())).toMatchObject({
      color: "black",
      strokeWidth: 2,
      fill: { color: "red", style: "solid" },
    });

    const colorEntry = setElementColor([rectangle], "blue")!;
    const widthEntry = setElementWidth([rectangle], 6)!;
    expect(readElementStyle([rectangle], document.getSnapshot())).toMatchObject({
      color: "blue",
      strokeWidth: 6,
    });
    expect(rectangle.getAttribute("stroke")).toBe("blue");
    expect(rectangle.getAttribute("stroke-width")).toBe("6");

    applyHistoryEntry(widthEntry, "undo");
    applyHistoryEntry(colorEntry, "undo");
    expect(rectangle.getAttribute("stroke")).toBe("black");
    expect(rectangle.getAttribute("stroke-width")).toBe("2");
  });

  test("records a generated fill definition and attribute as one entry", () => {
    const { document, rectangle } = createStyledRectangle();
    const entry = setElementFill(document, [rectangle], {
      color: "#2563eb",
      style: "dots",
    })!;

    expect(rectangle.getAttribute("fill")).toContain("toybox-fill-dots");
    expect(document.root.getElementsByTagName("pattern")).toHaveLength(1);

    applyHistoryEntry(entry, "undo");
    expect(rectangle.getAttribute("fill")).toBe("red");
    expect(document.root.getElementsByTagName("pattern")).toHaveLength(0);
  });

  test("routes a supported style change through native element styling", () => {
    const { document, rectangle } = createStyledRectangle();
    const entry = styleElements(document, [rectangle], {
      property: "color",
      value: "purple",
    })!;

    expect(rectangle.getAttribute("stroke")).toBe("purple");
    applyHistoryEntry(entry, "undo");
    expect(rectangle.getAttribute("stroke")).toBe("black");
  });
});
