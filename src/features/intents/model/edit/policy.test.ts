import { describe, expect, test } from "bun:test";
import { fixture, groundedFixture, plan, plannedFixture } from "../testFixtures";
import { canRegenerateSection } from "./policy";

describe("intent edit policy", () => {
  test("regenerates only content-safe sections", () => {
    const document = fixture();
    expect(
      canRegenerateSection(document.sections.find((section) => section.id === "overview")!),
    ).toBe(true);
    expect(
      canRegenerateSection(document.sections.find((section) => section.id === "concepts")!),
    ).toBe(true);
    expect(
      canRegenerateSection(
        document.sections.find((section) => section.id === "shared-rendering-flow-section")!,
      ),
    ).toBe(true);
    expect(
      canRegenerateSection(
        groundedFixture().sections.find((section) => section.id === "research-findings")!,
      ),
    ).toBe(true);
    expect(
      canRegenerateSection(document.sections.find((section) => section.id === "decisions")!),
    ).toBe(false);
    expect(canRegenerateSection(plan(plannedFixture(), "implementation"))).toBe(false);
  });
});
