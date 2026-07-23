import { describe, expect, test } from "bun:test";
import { isSupportedSvgImage } from "./images";

describe("SVG raster image admission", () => {
  test("accepts supported raster files within the artifact size limit", () => {
    expect(isSupportedSvgImage({ type: "image/png", size: 35_000_000 })).toBe(true);
    expect(isSupportedSvgImage({ type: "image/svg+xml", size: 10 })).toBe(false);
    expect(isSupportedSvgImage({ type: "image/jpeg", size: 35_000_001 })).toBe(false);
  });
});
