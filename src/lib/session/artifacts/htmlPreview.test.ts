import { describe, expect, test } from "bun:test";
import {
  HTML_PREVIEW_BRIDGE_ATTRIBUTE,
  HTML_PREVIEW_EDITABLE_MESSAGE_TYPE,
  createHtmlPreviewBaseUri,
  createHtmlPreviewUrl,
  injectHtmlPreviewBridge,
  stripHtmlPreviewBridge,
} from "./htmlPreview";

describe("HTML preview helpers", () => {
  test("creates preview URLs rooted at the HTML file directory", () => {
    const url = createHtmlPreviewUrl("toy-box-session", "index.html", 42);

    expect(url).toBe("/api/preview/toy-box-session/index.html?v=42");
  });

  test("creates an origin-qualified, directory-rooted base URI for relative embeds", () => {
    const baseUri = createHtmlPreviewBaseUri("toy-box-session", "plan.md", "http://localhost:3100");

    expect(baseUri).toBe("http://localhost:3100/api/preview/toy-box-session/");
    // Relative embeds land inside the preview namespace (root-absolute paths would not).
    expect(new URL("chart.html", baseUri).href).toBe(`${baseUri}chart.html`);
    expect(new URL("nested/chart.html", baseUri).href).toBe(`${baseUri}nested/chart.html`);
  });

  test("injects the editable preview bridge before body close", () => {
    const html = "<!doctype html><html><body><main>Hello</main></body></html>";

    const injected = injectHtmlPreviewBridge(html);

    expect(injected).toContain(`<script ${HTML_PREVIEW_BRIDGE_ATTRIBUTE}>`);
    expect(injected.indexOf(HTML_PREVIEW_BRIDGE_ATTRIBUTE)).toBeLessThan(
      injected.indexOf("</body>"),
    );
  });

  test("defers preview change notifications until after document load", () => {
    const html = "<!doctype html><html><body><main>Hello</main></body></html>";

    const injected = injectHtmlPreviewBridge(html);

    expect(injected).toContain("isReadyForUserChanges");
    expect(injected).toContain('window.addEventListener("load", markReadyForUserChanges');
  });

  test("toggles editability through a preview bridge message", () => {
    const html = "<!doctype html><html><body><main>Hello</main></body></html>";

    const injected = injectHtmlPreviewBridge(html);

    expect(injected).toContain(HTML_PREVIEW_EDITABLE_MESSAGE_TYPE);
    expect(injected).toContain('document.designMode = editable ? "on" : "off"');
    expect(injected).toContain("setEditable(false)");
  });

  test("strips preview bridge scripts before saving", () => {
    const html = `<html><body><script ${HTML_PREVIEW_BRIDGE_ATTRIBUTE}>bridge()</script><main>Hello</main></body></html>`;

    expect(stripHtmlPreviewBridge(html)).toBe("<html><body><main>Hello</main></body></html>");
  });

  test("replaces an existing preview bridge when injecting", () => {
    const html = `<html><body><script ${HTML_PREVIEW_BRIDGE_ATTRIBUTE}>old()</script><main>Hello</main></body></html>`;

    const injected = injectHtmlPreviewBridge(html);

    expect(injected).not.toContain("old()");
    expect(
      injected.match(new RegExp(`<script\\b(?=[^>]*\\b${HTML_PREVIEW_BRIDGE_ATTRIBUTE}\\b)`, "g")),
    ).toHaveLength(1);
  });
});
