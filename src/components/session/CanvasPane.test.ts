import { describe, expect, test } from "bun:test";
import { resolveCanvasUrl } from "./CanvasPane";

describe("resolveCanvasUrl", () => {
  test("rewrites loopback canvas URLs to the current host while preserving the canvas port", () => {
    expect(resolveCanvasUrl("http://127.0.0.1:51460/?instanceId=review-plan", "100.64.0.8")).toBe(
      "http://100.64.0.8:51460/?instanceId=review-plan",
    );
  });

  test("leaves non-loopback and invalid URLs unchanged", () => {
    expect(resolveCanvasUrl("https://example.com/canvas", "100.64.0.8")).toBe(
      "https://example.com/canvas",
    );
    expect(resolveCanvasUrl("not a url", "100.64.0.8")).toBe("not a url");
  });
});
