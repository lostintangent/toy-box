import { describe, expect, test } from "bun:test";
import { normalizeExtensions } from "./artifacts";

describe("normalizeExtensions", () => {
  test("strips leading dots, lowercases, and de-duplicates", () => {
    expect(normalizeExtensions([".JSON", "json", "Geojson"])).toEqual(["json", "geojson"]);
  });

  test("drops blank and non-string entries", () => {
    expect(normalizeExtensions(["json", "", "  ", 3, null])).toEqual(["json"]);
  });

  test("returns an empty list for non-array input", () => {
    expect(normalizeExtensions(undefined)).toEqual([]);
    expect(normalizeExtensions("json")).toEqual([]);
  });
});
