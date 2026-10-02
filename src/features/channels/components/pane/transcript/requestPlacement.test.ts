import { describe, expect, test } from "bun:test";
import { requestPlacement } from "./requestPlacement";

const viewport = { top: 1000, bottom: 1600 };

describe("request placement", () => {
  test("a request entirely above or below the viewport is placed there", () => {
    expect(requestPlacement({ top: 400, bottom: 500 }, viewport)).toBe("above");
    expect(requestPlacement({ top: 2000, bottom: 2100 }, viewport)).toBe("below");
  });

  test("any visible part of a request keeps it in view", () => {
    expect(requestPlacement({ top: 900, bottom: 1100 }, viewport)).toBeUndefined();
    expect(requestPlacement({ top: 1200, bottom: 1300 }, viewport)).toBeUndefined();
    expect(requestPlacement({ top: 1500, bottom: 1700 }, viewport)).toBeUndefined();
  });

  test("a request showing only beneath a pill is out of view", () => {
    expect(requestPlacement({ top: 950, bottom: 1040 }, viewport)).toBe("above");
    expect(requestPlacement({ top: 1560, bottom: 1700 }, viewport)).toBe("below");
  });

  test("a request taller than the viewport stays in view while it spans it", () => {
    expect(requestPlacement({ top: 500, bottom: 2000 }, viewport)).toBeUndefined();
  });
});
