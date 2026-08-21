import { describe, expect, test } from "bun:test";
import {
  effectiveRelations,
  findIntentEntity,
  intentEntities,
  recordDecisionOrigin,
  selectedAdditions,
} from "./projection";
import { sectionCanRefresh, sectionItemCount } from "./display";
import { chooseOption } from "./transitions";
import {
  fixture,
  sequencedFixture,
  recordsSection,
  sequence,
  stagedSequenceFixture,
} from "./testFixtures";

describe("intent projection", () => {
  test("projects provisional and decided option additions into target records sections", () => {
    const definition = fixture();
    const explored = chooseOption(definition, "diff-treatment", "shared");

    expect(explored).not.toBe(definition);
    expect(selectedAdditions(explored, "rendering-ownership")).toMatchObject([
      {
        item: { id: "shared-diff" },
        decisionId: "diff-treatment",
        optionId: "shared",
        optionLabel: "Diff is shared content",
        status: "provisional",
      },
    ]);
    expect(sectionItemCount(explored, recordsSection(explored, "rendering-ownership"))).toBe(2);
    expect(selectedAdditions(definition, "rendering-ownership")).toEqual([]);
    expect(effectiveRelations(explored)).toMatchObject([
      { relation: { id: "ordinary-tools-preserve-fallback" } },
      {
        relation: { id: "ordinary-tools-use-shared-diff" },
        decisionId: "diff-treatment",
        optionId: "shared",
        status: "provisional",
      },
    ]);
  });

  test("indexes relationship entities with reader-facing labels", () => {
    const definition = fixture();
    definition.sections.push({
      id: "plain-language",
      title: "What people get",
      purpose: "Lead with the behavior.",
      kind: "records",
      collapsed: false,
      view: "cards",
      provenance: "optional",
      subject: "Behavior",
      fields: [{ id: "outcome", label: "What happens", kind: "text" }],
      items: [
        {
          id: "clear-outcome",
          subject: "Keep the useful result visible",
          change: "new",
          values: {
            outcome: "Readers get the point without decoding a field label.",
          },
        },
      ],
    });
    definition.sections.push({
      id: "copy-rules",
      title: "What the copy keeps",
      purpose: "Compare the copy rules.",
      kind: "records",
      collapsed: false,
      view: "table",
      provenance: "optional",
      subject: "Part",
      fields: [
        {
          id: "handling",
          label: "Do this",
          kind: "choice",
          cardinality: "one",
          options: [{ id: "copy", label: "Copy" }],
        },
        { id: "result", label: "What that means", kind: "text" },
      ],
      items: [
        {
          id: "copy-color",
          subject: "Color",
          change: "new",
          values: { handling: "copy", result: "Keep the source color." },
        },
      ],
    });
    expect(findIntentEntity(definition, "ordinary-tools")).toMatchObject({
      label: "ordinary tools",
      change: "modified",
      detail: "Shape: Declared · Block kinds: Shared blocks",
    });
    expect(findIntentEntity(definition, "clear-outcome")).toMatchObject({
      detail: "Readers get the point without decoding a field label.",
    });
    expect(findIntentEntity(definition, "copy-color")).toMatchObject({
      detail: "Copy · Keep the source color.",
    });
    expect(findIntentEntity(definition, "tool-corpus")).toMatchObject({
      label: "Tool corpus",
    });
    expect(intentEntities(definition).some((entity) => entity.type === "decision")).toBe(true);
  });

  test("projects sequence work while keeping stages as containers", () => {
    const definition = stagedSequenceFixture();
    const entities = intentEntities(definition);

    expect(findIntentEntity(definition, "foundation-work")).toMatchObject({
      label: "Build the foundation",
      stage: { id: "foundation", title: "Establish the durable boundary" },
    });
    expect(entities.some((entity) => entity.id === "foundation")).toBe(false);
    expect(entities.filter((entity) => entity.type === "work")).toHaveLength(2);
  });

  test("finds the decision option that contributes a projected record", () => {
    const definition = fixture();

    expect(recordDecisionOrigin(definition, "shared-diff")).toMatchObject({
      decision: { id: "diff-treatment" },
      option: { id: "shared" },
      status: "inactive",
    });
    expect(
      recordDecisionOrigin(chooseOption(definition, "diff-treatment", "shared"), "shared-diff"),
    ).toMatchObject({
      decision: { id: "diff-treatment" },
      option: { id: "shared" },
      status: "provisional",
    });
  });

  test("refreshes only content-safe sections and groups", () => {
    const definition = fixture();
    expect(sectionCanRefresh(definition.sections[0]!)).toBe(true);
    expect(sectionCanRefresh(definition.sections[1]!)).toBe(true);
    expect(sectionCanRefresh(definition.sections[4]!)).toBe(false);
    expect(sectionCanRefresh(definition.sections[5]!)).toBe(false);
    expect(sectionCanRefresh(sequence(sequencedFixture(), "implementation"))).toBe(false);
  });
});
