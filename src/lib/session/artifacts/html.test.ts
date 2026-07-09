import { describe, expect, test } from "bun:test";
import {
  HTML_BASE_ATTRIBUTE,
  HTML_BRIDGE_ATTRIBUTE,
  HTML_EDITABLE_MESSAGE_TYPE,
  HTML_SOURCE_ATTRIBUTE,
  createArtifactBaseUri,
  injectBaseHref,
  wrapArtifactDocument,
} from "./html";

describe("HTML artifact documents", () => {
  test("creates an origin-qualified, directory-rooted base URI for relative embeds", () => {
    const baseUri = createArtifactBaseUri("toy-box-session", "plan.md", "http://localhost:3100");

    expect(baseUri).toBe("http://localhost:3100/api/serve/toy-box-session/");
    // Relative embeds land inside the artifact namespace (root-absolute paths would not).
    expect(new URL("chart.html", baseUri).href).toBe(`${baseUri}chart.html`);
    expect(new URL("nested/chart.html", baseUri).href).toBe(`${baseUri}nested/chart.html`);
  });

  test("points a wrapped document's relative embeds at the artifact directory via <base>", () => {
    const withHead = injectBaseHref(
      "<html><head></head><body></body></html>",
      "https://host/api/serve/s/dir/",
    );
    expect(withHead).toContain(
      `<head><base ${HTML_BASE_ATTRIBUTE} href="https://host/api/serve/s/dir/" />`,
    );
    // The base precedes any resource in the head, so every relative URL resolves through it.
    expect(withHead.indexOf("<base")).toBeLessThan(withHead.indexOf("</head>"));

    // A document without a head still gets one, so relative URLs have somewhere to resolve.
    expect(injectBaseHref("<body>hi</body>", "https://host/base/")).toContain(
      `<base ${HTML_BASE_ATTRIBUTE} href="https://host/base/" />`,
    );
  });

  test("marks the injected base so saving strips it with the bridge", () => {
    const injected = wrapArtifactDocument(
      "index.html",
      "<!doctype html><html><body><main>Hello</main></body></html>",
    );

    expect(injected).toContain(`const baseAttribute = "${HTML_BASE_ATTRIBUTE}"`);
    expect(injected).toContain('"],[" + baseAttribute + "]"');
  });

  test("wrapping an HTML file injects the editable bridge before body close", () => {
    const injected = wrapArtifactDocument(
      "index.html",
      "<!doctype html><html><body><main>Hello</main></body></html>",
    );

    expect(injected).toContain(`<script ${HTML_BRIDGE_ATTRIBUTE}>`);
    expect(injected.indexOf(HTML_BRIDGE_ATTRIBUTE)).toBeLessThan(injected.indexOf("</body>"));
  });

  test("suppresses saves until the loaded content is snapshotted, then only on a real change", () => {
    const injected = wrapArtifactDocument(
      "index.html",
      "<!doctype html><html><body><main>Hello</main></body></html>",
    );

    // The baseline is snapshotted on load...
    expect(injected).toContain('window.addEventListener("load", captureBaseline');
    // ...and a change is posted only when serialization differs from it, so our own setup
    // mutations (e.g. enabling edit mode) and no-op edits never trigger a save.
    expect(injected).toContain("if (content === savedContent) return;");
  });

  test("toggles editability through a bridge message", () => {
    const injected = wrapArtifactDocument(
      "index.html",
      "<!doctype html><html><body><main>Hello</main></body></html>",
    );

    expect(injected).toContain(HTML_EDITABLE_MESSAGE_TYPE);
    expect(injected).toContain('document.designMode = editable ? "on" : "off"');
    expect(injected).toContain("setEditable(false)");
  });

  test("replaces an existing bridge when re-wrapping", () => {
    const stale = `<html><body><script ${HTML_BRIDGE_ATTRIBUTE}>old()</script><main>Hello</main></body></html>`;

    const injected = wrapArtifactDocument("index.html", stale);

    expect(injected).not.toContain("old()");
    expect(
      injected.match(new RegExp(`<script\\b(?=[^>]*\\b${HTML_BRIDGE_ATTRIBUTE}\\b)`, "g")),
    ).toHaveLength(1);
  });

  test("wrapping an SVG embeds it in an editable, scrollable HTML document", () => {
    const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><text>Hello</text></svg>`;

    const document = wrapArtifactDocument("diagram.svg", svg);

    expect(document).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    );
    expect(document).toContain("-webkit-overflow-scrolling: touch");
    expect(document).toContain(`<main ${HTML_SOURCE_ATTRIBUTE}`);
    expect(document).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">',
    );
    // The XML preamble is dropped so the SVG can live inline in the HTML body.
    expect(document).not.toContain("<?xml");
    expect(document).toContain(`<script ${HTML_BRIDGE_ATTRIBUTE}>`);
  });

  test("marks the SVG source so the bridge serializes it — not the wrapper — back to disk", () => {
    const document = wrapArtifactDocument("diagram.svg", `<svg><text>Hello</text></svg>`);

    expect(document).toContain(`const sourceAttribute = "${HTML_SOURCE_ATTRIBUTE}"`);
    expect(document).toContain('source.getAttribute(serializeAttribute) === "children"');
    expect(document).toContain("clone.innerHTML.trim()");
  });

  test("edits the inline SVG as plaintext so rich HTML can't leak into the saved file", () => {
    const injected = wrapArtifactDocument("diagram.svg", `<svg><text>Hello</text></svg>`);

    expect(injected).toContain('"plaintext-only"');
  });
});
