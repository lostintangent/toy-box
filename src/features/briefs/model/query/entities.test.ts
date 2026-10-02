import { describe, expect, test } from "bun:test";
import { fixture, optionExhibitsFixture, phasedPlanFixture } from "../testFixtures";
import { briefEntities, findBriefEntity } from "./entities";

describe("brief entities", () => {
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
    expect(findBriefEntity(document, "ordinary-tools")).toMatchObject({
      label: "ordinary tools",
      change: "modified",
      detail: "Shape: Declared · Block kinds: Shared blocks",
    });
    expect(findBriefEntity(document, "clear-outcome")).toMatchObject({
      detail: "Readers get the point without decoding a field label.",
    });
    expect(findBriefEntity(document, "copy-color")).toMatchObject({
      detail: "Copy · Keep the source color.",
    });
    expect(findBriefEntity(document, "tool-corpus")).toMatchObject({
      label: "Tool corpus",
    });
    expect(briefEntities(document).some((entity) => entity.type === "decision")).toBe(true);
  });

  test("projects plan steps while keeping phases as containers", () => {
    const document = phasedPlanFixture();
    const entities = briefEntities(document);

    expect(findBriefEntity(document, "foundation-step")).toMatchObject({
      label: "Build the foundation",
      detail: "The durable API is tested.",
      phase: { id: "foundation", title: "Establish the durable boundary" },
    });
    expect(entities.some((entity) => entity.id === "foundation")).toBe(false);
    expect(entities.filter((entity) => entity.type === "plan-step")).toHaveLength(2);
  });

  test("keeps inactive option exhibits inspectable with their authoritative owner", () => {
    const document = optionExhibitsFixture();

    expect(findBriefEntity(document, "durable-state-preview")).toMatchObject({
      type: "exhibit",
      owner: {
        kind: "decision-option",
        decision: { id: "durability-policy" },
        option: { id: "durable" },
      },
    });
    expect(findBriefEntity(document, "ephemeral-state-preview")).toMatchObject({
      owner: { kind: "decision-option", option: { id: "ephemeral" } },
    });
  });
});
