import { describe, expect, test } from "bun:test";
import { allDecisions, allQuestions, findIntentEntity } from "./projection";
import { deliveryProjection } from "./delivery";
import { compareIntentToSavedVersion, saveIntentVersion } from "./checkpoints";
import {
  chooseOption,
  clearDecision,
  recordDecision,
  removeNewSharedItem,
  reopenDecision,
  reopenQuestion,
  updateIntentExhibit,
  updateIntentRecord,
  updateIntentWork,
} from "./transitions";
import {
  exhibitsFixture,
  fixture,
  mapSection,
  parse,
  sequencedFixture,
  recordsSection,
  stagedSequenceFixture,
} from "./testFixtures";

describe("intent transitions", () => {
  test("records only dependency-free choices and supports reopen and clear", () => {
    const explored = chooseOption(fixture(), "diff-treatment", "shared");
    expect(recordDecision(explored, "diff-treatment")).toBe(explored);

    const resolved = structuredClone(explored);
    allQuestions(resolved)[0]!.resolution = "Yes.";
    const decided = recordDecision(resolved, "diff-treatment");
    expect(allDecisions(decided)[0]).toMatchObject({
      chosen: "shared",
      status: "decided",
    });

    const reopened = reopenDecision(decided, "diff-treatment");
    expect(allDecisions(reopened)[0]).toMatchObject({
      chosen: "shared",
      status: "provisional",
    });

    const cleared = clearDecision(reopened, "diff-treatment");
    expect(allDecisions(cleared)[0]).toMatchObject({
      chosen: null,
      status: "open",
    });
  });

  test("reopens questions wherever their section is nested", () => {
    const definition = fixture();
    allQuestions(definition)[0]!.resolution = "Yes.";

    const reopened = reopenQuestion(definition, "diff-capability");
    expect(allQuestions(reopened)[0]!.resolution).toBeUndefined();
    expect(reopenQuestion(reopened, "missing")).toBe(reopened);
  });

  test("edits shared and option-owned records without changing graph identity", () => {
    const definition = fixture();
    const editedShared = updateIntentRecord(definition, "ordinary-tools", {
      subject: "everyday tools",
      change: "modified",
      values: { shape: "declared", content: ["shared", "text"] },
      explanation: "One shared path handles the common cases.",
      provenance: "ToolCallMessage.tsx#ToolCallMessage",
    });
    expect(findIntentEntity(editedShared, "ordinary-tools")).toMatchObject({
      label: "everyday tools",
      detail: "Shape: Declared · Block kinds: Shared blocks, Text",
      record: { explanation: "One shared path handles the common cases." },
    });
    expect(editedShared.relations).toEqual(definition.relations);

    const editedOption = updateIntentRecord(editedShared, "shared-diff", {
      subject: "edit output",
      change: "modified",
      values: { owner: "shared syntax-aware diff block" },
      provenance: "FileDiffToolCall.tsx#FileDiffToolCall",
    });
    expect(allDecisions(editedOption)[0]!.options[0]!.adds[0]).toMatchObject({
      id: "shared-diff",
      sectionId: "rendering-ownership",
      subject: "edit output",
      values: { owner: "shared syntax-aware diff block" },
    });
    expect(parse(editedOption)).toMatchObject({ ok: true });
    expect(
      updateIntentRecord(editedOption, "missing", {
        change: "new",
        values: {},
      }),
    ).toBe(editedOption);
  });

  test("edits exact exhibit content without changing graph identity", () => {
    const definition = exhibitsFixture();
    const edited = updateIntentExhibit(definition, "body-declaration", {
      title: "Declared result body",
      kind: "code",
      change: "modified",
      description: "The exact declaration ordinary tools provide.",
      language: "typescript",
      content: 'const body = {\n  kind: "text",\n  value: String(result),\n};\n',
      provenance: "ToolCallMessage.tsx#ToolCallMessage",
    });

    const entity = findIntentEntity(edited, "body-declaration");
    expect(entity).toMatchObject({
      label: "Declared result body",
      change: "modified",
    });
    expect(
      entity && "exhibit" in entity && entity.exhibit.kind === "code" ? entity.exhibit.content : "",
    ).toContain("String(result)");
    expect(edited.relations).toEqual(definition.relations);
    expect(parse(edited)).toMatchObject({ ok: true });
    expect(
      updateIntentExhibit(edited, "missing", {
        title: "Missing",
        kind: "code",
        change: "new",
        content: "noop",
      }),
    ).toBe(edited);
  });

  test("edits native work without changing its graph identity", () => {
    const saved = saveIntentVersion(sequencedFixture(), "2026-03-19T12:00:00.000Z");
    const edited = updateIntentWork(saved, "foundation-work", {
      title: "Build the durable foundation",
      values: { done: "The durable API and its boundary tests pass." },
    });

    const entity = findIntentEntity(edited, "foundation-work");

    expect(entity && "work" in entity ? entity.work : undefined).toMatchObject({
      id: "foundation-work",
      title: "Build the durable foundation",
    });
    expect(parse(edited)).toMatchObject({ ok: true });
    expect(compareIntentToSavedVersion(edited)?.changes).toContainEqual({
      status: "changed",
      key: "work:foundation-work",
      kind: "work",
      label: "Build the durable foundation",
      previousLabel: "Build the foundation",
      entityId: "foundation-work",
    });
  });

  test("edits work inside a named stage while preserving its stage identity", () => {
    const definition = stagedSequenceFixture();
    const saved = saveIntentVersion(definition, "2026-03-19T12:00:00.000Z");
    const edited = updateIntentWork(saved, "integration-work", {
      title: "Integrate the durable behavior",
      values: { done: "The complete runtime path uses the durable API." },
    });
    const entity = findIntentEntity(edited, "integration-work");

    expect(entity && "work" in entity ? entity.stage?.title : undefined).toBe(
      "Move the runtime onto it",
    );
    expect(parse(edited)).toMatchObject({ ok: true });
  });

  test("removes only shared new records", () => {
    const definition = fixture();
    const withoutBlock = removeNewSharedItem(definition, "concepts", "block");
    expect(recordsSection(withoutBlock, "concepts").items.map((item) => item.id)).toEqual([
      "tool-call",
    ]);
    expect(removeNewSharedItem(definition, "concepts", "tool-call")).toBe(definition);

    const explored = chooseOption(definition, "diff-treatment", "shared");
    expect(removeNewSharedItem(explored, "rendering-ownership", "shared-diff")).toBe(explored);
  });

  test("removes a work unit with every reference while leaving a valid partial sequence", () => {
    const withoutFoundation = removeNewSharedItem(
      sequencedFixture(),
      "implementation",
      "foundation-work",
    );

    expect(parse(withoutFoundation)).toMatchObject({ ok: true });
    expect(withoutFoundation.relations.map((relation) => relation.id)).toEqual([
      "changed-implemented-by-integration",
      "policy-implemented-by-integration",
    ]);
    expect(
      allDecisions(withoutFoundation)[0]!.options[0]!.relations.map((relation) => relation.id),
    ).toEqual(["changed-causes-durable"]);
    const delivery = deliveryProjection(withoutFoundation);
    expect(delivery.workUnits.map((unit) => unit.entity.id)).toEqual(["integration-work"]);
    expect(delivery.uncovered.map((entity) => entity.id)).toEqual(["durable-result"]);
    expect(removeNewSharedItem(withoutFoundation, "implementation", "integration-work")).toBe(
      withoutFoundation,
    );
  });

  test("removes and repairs maps that lose a selected record", () => {
    const definition = structuredClone(fixture());
    definition.relations.push({
      id: "block-realizes-tool-call",
      from: "block",
      to: "tool-call",
      kind: "realized-by",
    });
    definition.relations.push({
      id: "tool-call-preserves-fallback",
      from: "tool-call",
      to: "fallback-owner",
      kind: "preserves",
    });
    definition.sections.push(
      {
        id: "block-path",
        title: "Follow the block",
        purpose: "Trace the proposed block into the existing tool-call model.",
        kind: "map",
        collapsed: false,
        layout: "flow",
        roots: ["block"],
        relations: ["block-realizes-tool-call"],
      },
      {
        id: "block-routes",
        title: "Compare the block and fallback routes",
        purpose: "Keep one removable proposal beside one surviving route.",
        kind: "map",
        collapsed: false,
        layout: "paths",
        paths: [
          {
            id: "block-route",
            title: "The proposed block",
            purpose: "Follow the removable concept into the existing call.",
            root: "block",
            relations: ["block-realizes-tool-call"],
          },
          {
            id: "fallback-route",
            title: "The existing fallback",
            purpose: "Keep the independent route available.",
            root: "ordinary-tools",
            relations: ["ordinary-tools-preserve-fallback"],
          },
        ],
        regions: [
          {
            id: "block-side",
            title: "Block side",
            entities: ["block", "tool-call"],
          },
          {
            id: "fallback-side",
            title: "Fallback side",
            entities: ["ordinary-tools", "fallback-owner"],
          },
        ],
        relations: ["tool-call-preserves-fallback"],
      },
    );
    const removed = removeNewSharedItem(definition, "concepts", "block");
    expect(removed.sections.map((section) => section.id)).not.toContain("block-path");
    const survivingRoutes = mapSection(removed, "block-routes");
    if (survivingRoutes.layout !== "paths") throw new Error("Expected path map");
    expect(survivingRoutes.paths.map((path) => path.id)).toEqual(["fallback-route"]);
    expect(survivingRoutes.relations).toBeUndefined();
    expect(survivingRoutes.regions?.map((region) => region.id)).toEqual(["fallback-side"]);
    expect(parse(removed)).toMatchObject({ ok: true });
  });
});
