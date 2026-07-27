import { describe, expect, test } from "bun:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { parseSvgDocument, serializeSvgDocument } from "./source";

const parser = new DOMParser() as unknown as globalThis.DOMParser;
const serializer = new XMLSerializer() as unknown as globalThis.XMLSerializer;

describe("editable SVG document", () => {
  test("round-trips rich static SVG primitives without reducing them to editor shapes", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240">
  <defs>
    <linearGradient id="sky"><stop stop-color="#38bdf8" /></linearGradient>
    <marker id="arrow"><path d="M0 0 10 5 0 10z" /></marker>
    <filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="3" /></filter>
  </defs>
  <g id="scene" transform="translate(20 10)" filter="url(#shadow)">
    <path d="M 0 100 C 80 0 160 180 240 80" fill="none" stroke="url(#sky)" />
    <text x="120" y="210"><tspan font-weight="700">Water</tspan> cycle</text>
    <line x1="20" y1="180" x2="220" y2="40" marker-end="url(#arrow)" />
  </g>
</svg>`;

    const result = parseSvgDocument(source, parser);

    expect(result.error).toBeUndefined();
    expect(result.root?.getElementsByTagName("linearGradient")).toHaveLength(1);
    expect(result.root?.getElementsByTagName("marker")).toHaveLength(1);
    expect(result.root?.getElementsByTagName("filter")).toHaveLength(1);
    expect(result.root?.getElementsByTagName("path")).toHaveLength(2);
    expect(serializeSvgDocument(result.root!, serializer)).toContain(
      '<g id="scene" transform="translate(20 10)" filter="url(#shadow)">',
    );
  });

  test("rejects malformed XML, non-SVG roots, and external doctypes", () => {
    expect(parseSvgDocument("<svg>", parser).error).toBeDefined();
    expect(
      parseSvgDocument('<html xmlns="http://www.w3.org/1999/xhtml" />', parser).error,
    ).toContain("document root");
    expect(
      parseSvgDocument(
        '<!DOCTYPE svg SYSTEM "https://example.com/svg.dtd"><svg xmlns="http://www.w3.org/2000/svg" />',
        parser,
      ).error,
    ).toContain("doctype");
  });

  test("rejects executable and foreign-document content instead of silently stripping it", () => {
    const documents = [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="javascript:alert(1)" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://example.com/a.css";</style></svg>',
    ];

    for (const source of documents) {
      expect(parseSvgDocument(source, parser).error).toBeDefined();
    }
  });

  test("accepts local references, relative resources, safe remote resources, and raster data URLs", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg">
  <defs><filter id="blur"><feGaussianBlur stdDeviation="2" /></filter></defs>
  <image href="./photo.png" filter="url(#blur)" />
  <image href="https://example.com/photo.png" />
  <image href="data:image/png;base64,iVBORw0KGgo=" />
</svg>`;

    expect(parseSvgDocument(source, parser).error).toBeUndefined();
  });
});
