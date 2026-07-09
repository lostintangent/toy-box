import { describe, expect, test } from "bun:test";
import { resolveCanvasUrl } from "./CanvasPane";

describe("canvas URLs", () => {
  test("rewrites SDK loopback URLs to the browser hostname", () => {
    expect(resolveCanvasUrl("http://127.0.0.1:51460/view?id=one", "toybox.local")).toBe(
      "http://toybox.local:51460/view?id=one",
    );
  });

  test("preserves public HTTP URLs and rejects non-web URLs", () => {
    expect(resolveCanvasUrl("https://example.com/canvas", "toybox.local")).toBe(
      "https://example.com/canvas",
    );
    expect(resolveCanvasUrl("javascript:alert(1)", "toybox.local")).toBeUndefined();
    expect(resolveCanvasUrl("not a URL", "toybox.local")).toBeUndefined();
  });
});
