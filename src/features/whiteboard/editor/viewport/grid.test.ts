import { describe, expect, test } from "bun:test";
import { calculateSvgGridMetrics } from "./grid";

describe("SVG viewport grid", () => {
  test("keeps dots perceptible at both fit-scale and close zoom", () => {
    expect(calculateSvgGridMetrics(0.01)).toEqual({ spacing: 1280, radius: 100 });
    expect(calculateSvgGridMetrics(1)).toEqual({ spacing: 20, radius: 1 });
    expect(calculateSvgGridMetrics(10)).toEqual({ spacing: 20, radius: 0.3 });
  });
});
