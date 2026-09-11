import { describe, expect, test } from "bun:test";
import {
  activeOptionRelationships,
  decisionOriginForRecord,
  entitiesGroundedByFinding,
  findIntentEntity,
  findingsForEntity,
  intentEntities,
  selectedAdditions,
} from "./reading";
import { selectDecisionOption } from "../edit";
import {
  fixture,
  groundedFixture,
  optionExhibitsFixture,
  phasedPlanFixture,
} from "../testFixtures";

describe("intent queries", () => {
  test("projects provisional and decided option additions into target records sections", () => {
    const document = fixture();
    const explored = selectDecisionOption(document, "diff-treatment", "shared");

    expect(explored).not.toBe(document);
    expect(selectedAdditions(explored, "rendering-ownership")).toMatchObject([
      {
        item: { id: "shared-diff" },
        decisionId: "diff-treatment",
        optionId: "shared",
        optionLabel: "Diff is shared content",
        status: "provisional",
      },
    ]);
    expect(selectedAdditions(document, "rendering-ownership")).toEqual([]);
    expect(activeOptionRelationships(explored)).toMatchObject([
      {
        relationship: { id: "ordinary-tools-use-shared-diff" },
        decisionId: "diff-treatment",
        optionId: "shared",
        status: "provisional",
      },
    ]);
  });

  test("indexes relationship entities with reader-facing labels", () => {
    const document = fixture();
    document.sections.push({
      id: "plain-language",
      title: "What people get",
      purpose: "Lead with the behavior.",
      kind: "records",
      collapsed: false,
      view: "cards",
      sourcePolicy: "optional",
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
    document.sections.push({
      id: "copy-rules",
      title: "What the copy keeps",
      purpose: "Compare the copy rules.",
      kind: "records",
      collapsed: false,
      view: "table",
      sourcePolicy: "optional",
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
    expect(findIntentEntity(document, "ordinary-tools")).toMatchObject({
      label: "ordinary tools",
      change: "modified",
      detail: "Shape: Declared · Block kinds: Shared blocks",
    });
    expect(findIntentEntity(document, "clear-outcome")).toMatchObject({
      detail: "Readers get the point without decoding a field label.",
    });
    expect(findIntentEntity(document, "copy-color")).toMatchObject({
      detail: "Copy · Keep the source color.",
    });
    expect(findIntentEntity(document, "tool-corpus")).toMatchObject({
      label: "Tool corpus",
    });
    expect(intentEntities(document).some((entity) => entity.type === "decision")).toBe(true);
  });

  test("reads grounding in both directions without making findings plan targets", () => {
    const document = groundedFixture();

    expect(findingsForEntity(document, "ordinary-tools").map((finding) => finding.id)).toEqual([
      "finding-shared-owner",
    ]);
    expect(
      entitiesGroundedByFinding(document, "finding-shared-owner").map((entity) => entity.id),
    ).toEqual(["ordinary-tools", "shared-rendering-flow"]);
    expect(findingsForEntity(document, "diff-treatment").map((finding) => finding.id)).toEqual([
      "finding-fallback",
    ]);
  });

  test("projects plan steps while keeping phases as containers", () => {
    const document = phasedPlanFixture();
    const entities = intentEntities(document);

    expect(findIntentEntity(document, "foundation-step")).toMatchObject({
      label: "Build the foundation",
      detail: "The durable API is tested.",
      phase: { id: "foundation", title: "Establish the durable boundary" },
    });
    expect(entities.some((entity) => entity.id === "foundation")).toBe(false);
    expect(entities.filter((entity) => entity.type === "plan-step")).toHaveLength(2);
  });

  test("finds the decision option that contributes a projected record", () => {
    const document = fixture();

    expect(decisionOriginForRecord(document, "shared-diff")).toMatchObject({
      decision: { id: "diff-treatment" },
      option: { id: "shared" },
      status: "inactive",
    });
    expect(
      decisionOriginForRecord(
        selectDecisionOption(document, "diff-treatment", "shared"),
        "shared-diff",
      ),
    ).toMatchObject({
      decision: { id: "diff-treatment" },
      option: { id: "shared" },
      status: "provisional",
    });
  });

  test("keeps inactive option exhibits inspectable with their authoritative owner", () => {
    const document = optionExhibitsFixture();

    expect(findIntentEntity(document, "durable-state-preview")).toMatchObject({
      type: "exhibit",
      owner: {
        kind: "decision-option",
        decision: { id: "durability-policy" },
        option: { id: "durable" },
      },
    });
    expect(findIntentEntity(document, "ephemeral-state-preview")).toMatchObject({
      owner: { kind: "decision-option", option: { id: "ephemeral" } },
    });
  });
});
