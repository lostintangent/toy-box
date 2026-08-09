import { describe, expect, test } from "bun:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { SvgDocument } from "../../document";
import { applyHistoryEntry } from "../../document/history";
import { pasteSvgSelectionClipboard, serializeSvgSelectionClipboard } from "./clipboard";

const parser = new DOMParser() as unknown as globalThis.DOMParser;
const serializer = new XMLSerializer() as unknown as globalThis.XMLSerializer;

function createDocument() {
  const document = new SvgDocument({ parser, serializer });
  document.load('<svg xmlns="http://www.w3.org/2000/svg"><rect id="source" /></svg>');
  return document;
}

describe("SVG selection clipboard", () => {
  test("round-trips selected markup as one offset, reversible insertion", () => {
    const document = createDocument();
    const rectangle = document.root.getElementsByTagName(
      "rect",
    )[0] as unknown as SVGGraphicsElement;
    const payload = serializeSvgSelectionClipboard(document, [rectangle]);
    const pasted = pasteSvgSelectionClipboard(document, payload)!;

    expect(document.root.getElementsByTagName("rect")).toHaveLength(2);
    expect(document.root.getElementsByTagName("rect")[1]?.getAttribute("transform")).toBe(
      "translate(20 20)",
    );

    applyHistoryEntry(pasted.entry, "undo");
    expect(document.root.getElementsByTagName("rect")).toHaveLength(1);
  });

  test("rejects unrelated and unsafe clipboard payloads", () => {
    const document = createDocument();

    expect(pasteSvgSelectionClipboard(document, "plain text")).toBeNull();
    expect(
      pasteSvgSelectionClipboard(
        document,
        JSON.stringify({
          type: "toy-box-svg-elements",
          elements: ['<script xmlns="http://www.w3.org/2000/svg" />'],
        }),
      ),
    ).toBeNull();
  });
});
