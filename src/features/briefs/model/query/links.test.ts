import { describe, expect, test } from "bun:test";
import { selectDecisionOption } from "../edit";
import { fixture, groundedFixture, phasedPlanFixture } from "../testFixtures";
import { entityLinks } from "./links";

const ids = (entities: readonly { id: string }[]) => entities.map(({ id }) => id);

describe("entity links", () => {
  test("reads grounding in both directions", () => {
    const document = groundedFixture();

    expect(ids(entityLinks(document, "ordinary-tools").basedOn)).toEqual(["finding-shared-owner"]);
    expect(ids(entityLinks(document, "finding-shared-owner").grounds)).toEqual([
      "ordinary-tools",
      "shared-rendering-flow",
    ]);
    expect(ids(entityLinks(document, "diff-treatment").basedOn)).toEqual(["finding-fallback"]);
  });

  test("reads implementation links in both directions", () => {
    const document = phasedPlanFixture();

    expect(ids(entityLinks(document, "foundation-step").implements)).toEqual(["durable-result"]);
    expect(ids(entityLinks(document, "changed-behavior").implementedBy)).toEqual([
      "integration-step",
    ]);
  });

  test("reads impact in both directions", () => {
    const document = fixture();

    expect(ids(entityLinks(document, "diff-capability").affects)).toEqual(["ordinary-tools"]);
    expect(ids(entityLinks(document, "diff-treatment").affects)).toEqual(["ordinary-tools"]);
    expect(ids(entityLinks(document, "ordinary-tools").affectedBy)).toEqual([
      "diff-capability",
      "diff-treatment",
    ]);
  });

  test("finds the decision option that adds a record whether or not it is active", () => {
    const document = fixture();

    expect(entityLinks(document, "shared-diff").origin).toMatchObject({
      decision: { id: "diff-treatment" },
      option: { id: "shared" },
      status: "inactive",
    });
    expect(
      entityLinks(selectDecisionOption(document, "diff-treatment", "shared"), "shared-diff").origin,
    ).toMatchObject({ option: { id: "shared" }, status: "provisional" });
    expect(entityLinks(document, "ordinary-tools").origin).toBeUndefined();
  });

  test("follows only active option relationships, from either end", () => {
    const document = fixture();
    const explored = selectDecisionOption(document, "diff-treatment", "shared");

    expect(entityLinks(document, "ordinary-tools").activeRelationships).toEqual([]);
    expect(entityLinks(explored, "ordinary-tools").activeRelationships).toMatchObject([
      {
        relationship: { id: "ordinary-tools-use-shared-diff" },
        outgoing: true,
        related: { id: "shared-diff" },
        activeOption: { option: { id: "shared" }, status: "provisional" },
      },
    ]);
    expect(entityLinks(explored, "shared-diff").activeRelationships).toMatchObject([
      { outgoing: false, related: { id: "ordinary-tools" } },
    ]);
  });
});
