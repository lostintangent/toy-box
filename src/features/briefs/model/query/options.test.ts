import { describe, expect, test } from "bun:test";
import { selectDecisionOption } from "../edit";
import { fixture } from "../testFixtures";
import { projectedRecords } from "./options";

describe("active options", () => {
  test("projects provisional and decided option additions into target records sections", () => {
    const document = fixture();
    const explored = selectDecisionOption(document, "diff-treatment", "shared");

    expect(explored).not.toBe(document);
    expect(projectedRecords(explored, "rendering-ownership")).toMatchObject([
      { record: { id: "fallback-owner" } },
      {
        record: { id: "shared-diff" },
        activeOption: {
          decision: { id: "diff-treatment" },
          option: { id: "shared" },
          status: "provisional",
        },
      },
    ]);
    expect(projectedRecords(document, "rendering-ownership")).toEqual([
      { record: expect.objectContaining({ id: "fallback-owner" }) },
    ]);
  });
});
