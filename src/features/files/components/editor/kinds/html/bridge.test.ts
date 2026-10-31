import { describe, expect, test } from "bun:test";
import {
  HTML_BASE_ATTRIBUTE,
  HTML_BRIDGE_ATTRIBUTE,
  injectBaseHref,
  injectHtmlBridge,
} from "./bridge";

describe("HTML artifact documents", () => {
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

  test("injects the editable bridge before the body closes", () => {
    const injected = injectHtmlBridge(
      "<!doctype html><html><body><main>Hello</main></body></html>",
    );

    expect(injected).toContain(`<script ${HTML_BRIDGE_ATTRIBUTE}>`);
    expect(injected.indexOf(HTML_BRIDGE_ATTRIBUTE)).toBeLessThan(injected.indexOf("</body>"));
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
