import { describe, expect, test } from "bun:test";
import {
  HTML_BASE_ATTRIBUTE,
  HTML_BRIDGE_ATTRIBUTE,
  HTML_EDITABLE_MESSAGE_TYPE,
  createArtifactBaseUri,
  injectBaseHref,
  injectHtmlBridge,
} from "./html";

describe("HTML artifact documents", () => {
  test("creates an origin-qualified, directory-rooted base URI for relative embeds", () => {
    const baseUri = createArtifactBaseUri("toy-box-session", "plan.md", "http://localhost:3100");

    expect(baseUri).toBe("http://localhost:3100/api/serve/toy-box-session/");
    // Relative embeds land inside the artifact namespace (root-absolute paths would not).
    expect(new URL("chart.html", baseUri).href).toBe(`${baseUri}chart.html`);
    expect(new URL("nested/chart.html", baseUri).href).toBe(`${baseUri}nested/chart.html`);
  });

  test("points a document's relative embeds at the artifact directory via <base>", () => {
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
    const injected = injectHtmlBridge(
      "<!doctype html><html><body><main>Hello</main></body></html>",
    );

    expect(injected).toContain(`const baseAttribute = "${HTML_BASE_ATTRIBUTE}"`);
    expect(injected).toContain('"],[" + baseAttribute + "]"');
  });

  test("injects the editable bridge before the body closes", () => {
    const injected = injectHtmlBridge(
      "<!doctype html><html><body><main>Hello</main></body></html>",
    );

    expect(injected).toContain(`<script ${HTML_BRIDGE_ATTRIBUTE}>`);
    expect(injected.indexOf(HTML_BRIDGE_ATTRIBUTE)).toBeLessThan(injected.indexOf("</body>"));
  });

  test("suppresses saves until the loaded content is snapshotted, then only on a real change", () => {
    const injected = injectHtmlBridge(
      "<!doctype html><html><body><main>Hello</main></body></html>",
    );

    // The baseline is snapshotted on load...
    expect(injected).toContain('window.addEventListener("load", captureBaseline');
    // ...and a change is posted only when serialization differs from it, so our own setup
    // mutations (e.g. enabling edit mode) and no-op edits never trigger a save.
    expect(injected).toContain("if (content === savedContent) return;");
  });

  test("toggles editability through a bridge message", () => {
    const injected = injectHtmlBridge(
      "<!doctype html><html><body><main>Hello</main></body></html>",
    );

    expect(injected).toContain(HTML_EDITABLE_MESSAGE_TYPE);
    expect(injected).toContain('document.designMode = editable ? "on" : "off"');
    expect(injected).toContain("setEditable(false)");
  });

  test("replaces an existing bridge when reinjected", () => {
    const stale = `<html><body><script ${HTML_BRIDGE_ATTRIBUTE}>old()</script><main>Hello</main></body></html>`;

    const injected = injectHtmlBridge(stale);

    expect(injected).not.toContain("old()");
    expect(
      injected.match(new RegExp(`<script\\b(?=[^>]*\\b${HTML_BRIDGE_ATTRIBUTE}\\b)`, "g")),
    ).toHaveLength(1);
  });
});
