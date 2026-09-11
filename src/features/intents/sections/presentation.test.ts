import { describe, expect, test } from "bun:test";
import { selectDecisionOption } from "../model/edit";
import { findExhibitsSection } from "../model/index";
import { exhibitsFixture, fixture, recordsSection } from "../model/testFixtures";
import { countSectionItems } from "./presentation";

describe("intent section presentation", () => {
  test("counts authored and decision-projected items", () => {
    const explored = selectDecisionOption(fixture(), "diff-treatment", "shared");
    expect(countSectionItems(explored, recordsSection(explored, "rendering-ownership"))).toBe(2);

    const exhibits = exhibitsFixture();
    const section = findExhibitsSection(exhibits, "technical-definitions");
    if (!section) throw new Error("Missing exhibits section");
    expect(countSectionItems(exhibits, section)).toBe(2);
  });
});
