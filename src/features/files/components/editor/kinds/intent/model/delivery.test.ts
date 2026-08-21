import { describe, expect, test } from "bun:test";
import { serializeIntent } from "./schema";
import { allDecisions } from "./projection";
import { relationshipMapRelations } from "./maps";
import { deliveryProjection, executionReadiness, implementationObligations } from "./delivery";
import { workItems } from "./sequence";
import { parse, sequence, sequencedFixture, stagedSequenceFixture } from "./testFixtures";

describe("intent delivery", () => {
  test("validates implementation work boundaries and acyclic dependencies", () => {
    expect(parse(sequencedFixture())).toMatchObject({ ok: true });

    const legacySequence = JSON.parse(serializeIntent(sequencedFixture()));
    const legacySection = legacySequence.sections.find(
      (section: { id: string }) => section.id === "implementation",
    );
    Object.assign(legacySection, {
      kind: "records",
      view: "sequence",
      provenance: "optional",
      subject: "Work unit",
      items: legacySection.items.map((item: { id: string; title: string; values: unknown }) => ({
        id: item.id,
        subject: item.title,
        change: "new",
        values: item.values,
      })),
    });
    expect(parse(legacySequence)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Invalid input"),
    });

    const unlinkedWork = structuredClone(sequencedFixture());
    const unlinkedSequence = sequence(unlinkedWork, "implementation");
    if (!("items" in unlinkedSequence)) throw new Error("Expected flat sequence");
    unlinkedSequence.items.push({
      id: "unlinked-work",
      title: "Unlinked work",
      values: { done: "It exists." },
    });
    expect(parse(unlinkedWork)).toMatchObject({
      ok: false,
      error: expect.stringContaining("must be an implementation work unit"),
    });

    const invalidTarget = structuredClone(sequencedFixture());
    invalidTarget.relations[0]!.to = "changed-behavior";
    expect(parse(invalidTarget)).toMatchObject({ ok: false });

    const workUnitSource = structuredClone(sequencedFixture());
    workUnitSource.relations[0]!.from = "foundation-work";
    expect(parse(workUnitSource)).toMatchObject({ ok: false });

    const missingReason = structuredClone(sequencedFixture());
    delete missingReason.relations[2]!.label;
    expect(parse(missingReason)).toMatchObject({ ok: false });

    const duplicateCoverage = structuredClone(sequencedFixture());
    duplicateCoverage.relations.push({
      ...duplicateCoverage.relations[0]!,
      id: "duplicate-changed-coverage",
    });
    expect(parse(duplicateCoverage)).toMatchObject({ ok: false });

    const cycle = structuredClone(sequencedFixture());
    cycle.relations.push({
      id: "foundation-depends-on-integration",
      from: "foundation-work",
      to: "integration-work",
      kind: "depends-on",
      label: "creates a cycle",
    });
    expect(parse(cycle)).toMatchObject({ ok: false });

    const staged = stagedSequenceFixture();
    expect(workItems(sequence(staged, "implementation")).map((item) => item.id)).toEqual([
      "foundation-work",
      "integration-work",
    ]);

    const reversedStages = structuredClone(staged);
    const reversedSequence = sequence(reversedStages, "implementation");
    if (!("stages" in reversedSequence)) throw new Error("Expected staged sequence");
    reversedSequence.stages.reverse();
    expect(parse(reversedStages)).toMatchObject({
      ok: false,
      error: expect.stringContaining("must match its dependency-derived delivery phases"),
    });

    const duplicateStage = structuredClone(staged);
    const duplicateSequence = sequence(duplicateStage, "implementation");
    if (!("stages" in duplicateSequence)) throw new Error("Expected staged sequence");
    duplicateSequence.stages[1]!.id = duplicateSequence.stages[0]!.id;
    expect(parse(duplicateStage)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Stages in"),
    });

    const mixedSequence = JSON.parse(serializeIntent(staged));
    const mixedSection = mixedSequence.sections.find(
      (section: { id: string }) => section.id === "implementation",
    );
    mixedSection.items = mixedSection.stages.flatMap((stage: { items: unknown[] }) => stage.items);
    expect(parse(mixedSequence)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Invalid input"),
    });
  });

  test("derives obligation coverage and parallelizable implementation phases", () => {
    const definition = sequencedFixture();
    expect(implementationObligations(definition).map((entity) => entity.id)).toEqual([
      "changed-behavior",
      "durable-result",
      "durability-policy",
    ]);

    const delivery = deliveryProjection(definition);
    expect(delivery.complete).toBe(true);
    expect(delivery.uncovered).toEqual([]);
    expect(delivery.phases.map((phase) => phase.map((unit) => unit.entity.id))).toEqual([
      ["foundation-work"],
      ["integration-work"],
    ]);
    expect(delivery.workUnits[1]?.coverage.map(({ source }) => source.id)).toEqual([
      "changed-behavior",
      "durability-policy",
    ]);
    expect(relationshipMapRelations(definition).map(({ relation }) => relation.id)).toEqual([
      "changed-causes-durable",
    ]);
  });

  test("treats a changed exhibit as a coverable delivery obligation", () => {
    const definition = structuredClone(sequencedFixture());
    definition.sections.push({
      id: "exact-migration",
      title: "Exact migration",
      purpose: "Pin the command the foundation work must provide.",
      kind: "exhibits",
      collapsed: false,
      provenance: "optional",
      items: [
        {
          id: "migration-command",
          title: "Migration command",
          kind: "code",
          change: "new",
          language: "bash",
          content: "toy-box migrate --durable-state",
        },
      ],
    });
    definition.relations.push({
      id: "migration-command-implemented-by-foundation",
      from: "migration-command",
      to: "foundation-work",
      kind: "implemented-by",
    });
    const parsed = parse(definition);
    if (!parsed.ok) throw new Error(parsed.error);

    const delivery = deliveryProjection(parsed.value);
    expect(delivery.complete).toBe(true);
    expect(
      delivery.workUnits[0]?.coverage.some(
        ({ source }) => source.type === "exhibit" && source.id === "migration-command",
      ),
    ).toBe(true);
  });

  test("lets prose guide work without becoming a required coverage obligation", () => {
    const definition = structuredClone(sequencedFixture());
    definition.sections.unshift({
      id: "delivery-guidance",
      title: "Delivery guidance",
      purpose: "Keep a concise implementation boundary visible.",
      kind: "prose",
      collapsed: false,
      body: "Keep the durable API independent from transcript presentation.",
    });
    definition.relations.push({
      id: "delivery-guidance-implemented-by-foundation",
      from: "delivery-guidance",
      to: "foundation-work",
      kind: "implemented-by",
    });
    const parsed = parse(definition);
    if (!parsed.ok) throw new Error(parsed.error);

    const delivery = deliveryProjection(parsed.value);
    expect(delivery.obligations.map((entity) => entity.id)).not.toContain("delivery-guidance");
    expect(delivery.workUnits[0]?.coverage.map(({ source }) => source.id)).toContain(
      "delivery-guidance",
    );
    expect(delivery.complete).toBe(true);
  });

  test("keeps prerequisite-only work in the implementation sequence", () => {
    const definition = sequencedFixture();
    const decision = allDecisions(definition)[0]!;
    decision.status = "provisional";
    decision.blocking = false;

    const delivery = deliveryProjection(definition);
    expect(delivery.complete).toBe(true);
    expect(delivery.uncovered).toEqual([]);
    expect(delivery.phases.map((phase) => phase.map((unit) => unit.entity.id))).toEqual([
      ["foundation-work"],
      ["integration-work"],
    ]);
    expect(delivery.workUnits[0]?.coverage).toEqual([]);
  });

  test("starts settled intent directly but holds an authored sequence to complete coverage", () => {
    const unsequenced = structuredClone(sequencedFixture());
    unsequenced.sections = unsequenced.sections.filter((section) => section.kind !== "sequence");
    unsequenced.relations = unsequenced.relations.filter(
      (relation) => relation.kind !== "implemented-by" && relation.kind !== "depends-on",
    );
    for (const decision of allDecisions(unsequenced)) {
      for (const option of decision.options) {
        option.relations = option.relations.filter(
          (relation) => relation.kind !== "implemented-by" && relation.kind !== "depends-on",
        );
      }
    }
    const parsed = parse(unsequenced);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(executionReadiness(parsed.value)).toMatchObject({
      ready: true,
      delivery: { present: false, complete: false },
    });

    const incomplete = structuredClone(sequencedFixture());
    const behavior = incomplete.sections.find((section) => section.id === "behavior");
    if (!behavior || behavior.kind !== "records") throw new Error("Missing behavior records");
    behavior.items.push({
      id: "uncovered-behavior",
      subject: "Uncovered behavior",
      change: "new",
      values: { result: "Still needs delivery work." },
    });
    const incompleteParsed = parse(incomplete);
    if (!incompleteParsed.ok) throw new Error(incompleteParsed.error);
    expect(executionReadiness(incompleteParsed.value)).toMatchObject({
      ready: false,
      delivery: {
        present: true,
        complete: false,
        uncovered: [{ id: "uncovered-behavior" }],
      },
    });
  });
});
