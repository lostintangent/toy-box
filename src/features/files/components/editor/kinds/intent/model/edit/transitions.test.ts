import { describe, expect, test } from "bun:test";
import { planSections, planState } from "../plan";
import {
  allDecisions,
  allFindings,
  allQuestions,
  findIntentEntity,
  findingsForEntity,
} from "../query/reading";
import { specState } from "../spec";
import {
  selectDecisionOption,
  clearDecisionChoice,
  removeExhibit,
  removeFinding,
  removeRecord,
  recordDecision,
  removeSection,
  reopenDecision,
  reopenQuestion,
  setRecordsView,
  setSectionCollapsed,
  setSectionsCollapsed,
  updateExhibit,
  updateFinding,
  updateRecord,
  updatePlanStep,
} from "./transitions";
import {
  exhibitsFixture,
  flowExhibit,
  fixture,
  groundedFixture,
  optionExhibitsFixture,
  parse,
  phasedPlanFixture,
  plan,
  plannedFixture,
  recordsSection,
} from "../testFixtures";

describe("intent transitions", () => {
  test("records only dependency-free choices and supports reopen and clear", () => {
    const explored = selectDecisionOption(fixture(), "diff-treatment", "shared");
    expect(recordDecision(explored, "diff-treatment")).toBe(explored);

    const resolved = structuredClone(explored);
    allQuestions(resolved)[0]!.answer = "Yes.";
    const decided = recordDecision(resolved, "diff-treatment");
    expect(allDecisions(decided)[0]).toMatchObject({
      choice: { optionId: "shared", status: "decided" },
    });

    const reopened = reopenDecision(decided, "diff-treatment");
    expect(allDecisions(reopened)[0]).toMatchObject({
      choice: { optionId: "shared", status: "provisional" },
    });

    const cleared = clearDecisionChoice(reopened, "diff-treatment");
    expect(allDecisions(cleared)[0]).not.toHaveProperty("choice");
  });

  test("reopens questions without changing how they should be answered", () => {
    const document = fixture();
    allQuestions(document)[0]!.answer = "Yes.";

    const reopened = reopenQuestion(document, "diff-capability");
    expect(allQuestions(reopened)[0]!.answer).toBeUndefined();
    expect(reopenQuestion(reopened, "missing")).toBe(reopened);
  });

  test("persists disclosure and records view changes", () => {
    const document = fixture();
    const collapsed = setSectionCollapsed(document, "overview", true);
    expect(collapsed.sections.find((section) => section.id === "overview")?.collapsed).toBe(true);

    const nestedCollapsed = setSectionCollapsed(collapsed, "concepts", true);
    expect(recordsSection(nestedCollapsed, "concepts").collapsed).toBe(true);

    const allCollapsed = setSectionsCollapsed(
      nestedCollapsed,
      nestedCollapsed.sections.map((section) => section.id),
      true,
    );
    expect(allCollapsed.sections.every((section) => section.collapsed)).toBe(true);

    const cards = setRecordsView(allCollapsed, "tool-corpus", "cards");
    expect(recordsSection(cards, "tool-corpus").view).toBe("cards");
    const nestedTable = setRecordsView(cards, "concepts", "table");
    expect(recordsSection(nestedTable, "concepts").view).toBe("table");
    expect(setRecordsView(nestedTable, "concepts", "table")).toBe(nestedTable);

    expect(parse(nestedTable)).toMatchObject({ ok: true });
  });

  test("edits shared and option-owned records without changing intent identity", () => {
    const document = fixture();
    const editedShared = updateRecord(document, "ordinary-tools", {
      subject: "everyday tools",
      change: "modified",
      values: { shape: "declared", content: ["shared", "text"] },
      explanation: "One shared path handles the common cases.",
      source: "ToolCallMessage.tsx#ToolCallMessage",
    });
    expect(findIntentEntity(editedShared, "ordinary-tools")).toMatchObject({
      label: "everyday tools",
      detail: "Shape: Declared · Block kinds: Shared blocks, Text",
      record: { explanation: "One shared path handles the common cases." },
    });
    expect(flowExhibit(editedShared, "shared-rendering-flow").connections).toEqual(
      flowExhibit(document, "shared-rendering-flow").connections,
    );

    const editedOption = updateRecord(editedShared, "shared-diff", {
      subject: "edit output",
      change: "modified",
      values: { owner: "shared syntax-aware diff block" },
      source: "FileDiffToolCall.tsx#FileDiffToolCall",
    });
    expect(allDecisions(editedOption)[0]!.options[0]!.adds[0]).toMatchObject({
      id: "shared-diff",
      sectionId: "rendering-ownership",
      subject: "edit output",
      values: { owner: "shared syntax-aware diff block" },
    });
    expect(parse(editedOption)).toMatchObject({ ok: true });
    expect(
      updateRecord(editedOption, "missing", {
        change: "new",
        values: {},
      }),
    ).toBe(editedOption);
  });

  test("edits findings and grounded spec entities without losing semantic links", () => {
    const document = groundedFixture();
    const finding = allFindings(document)[0]!;
    const supportingExhibit = finding.exhibit;
    const editedFinding = updateFinding(document, finding.id, {
      statement: "The common tool-call frame already owns lifecycle and actions.",
      whyItMatters: "A shared body needs no second lifecycle owner.",
      sources: ["ToolCallMessage.tsx#ToolCallMessage"],
    });

    expect(allFindings(editedFinding)[0]).toMatchObject({
      id: "finding-shared-owner",
      statement: "The common tool-call frame already owns lifecycle and actions.",
    });
    expect(allFindings(editedFinding)[0]!.exhibit).toBe(supportingExhibit);

    const conciseFinding = updateFinding(editedFinding, finding.id, {
      statement: "The common tool-call frame already owns lifecycle and actions.",
      sources: finding.sources,
    });
    expect(allFindings(conciseFinding)[0]).toEqual({
      id: finding.id,
      statement: "The common tool-call frame already owns lifecycle and actions.",
      sources: finding.sources,
      exhibit: supportingExhibit,
    });
    expect(parse(conciseFinding)).toMatchObject({ ok: true });

    const editedRecord = updateRecord(editedFinding, "ordinary-tools", {
      subject: "ordinary tool calls",
      change: "modified",
      values: { shape: "declared", content: ["shared"] },
      source: "ToolCallMessage.tsx#ToolCallMessage",
    });
    expect(findingsForEntity(editedRecord, "ordinary-tools").map((item) => item.id)).toEqual([
      "finding-shared-owner",
    ]);

    const groundedFlow = flowExhibit(editedRecord, "shared-rendering-flow");
    const editedExhibit = updateExhibit(editedRecord, groundedFlow.id, {
      ...groundedFlow,
      title: "Shared rendering routes",
    });
    expect(findingsForEntity(editedExhibit, groundedFlow.id).map((item) => item.id)).toEqual([
      "finding-shared-owner",
    ]);
    expect(parse(editedExhibit)).toMatchObject({ ok: true });
  });

  test("removes findings while repairing every grounded spec reference", () => {
    const document = groundedFixture();
    const withoutOwnerFinding = removeFinding(
      document,
      "research-findings",
      "finding-shared-owner",
    );

    expect(findIntentEntity(withoutOwnerFinding, "finding-shared-owner")).toBeUndefined();
    expect(findingsForEntity(withoutOwnerFinding, "ordinary-tools")).toEqual([]);
    expect(findingsForEntity(withoutOwnerFinding, "shared-rendering-flow")).toEqual([]);
    expect(parse(withoutOwnerFinding)).toMatchObject({ ok: true });

    const withoutFindings = removeSection(document, "research-findings");
    expect(allFindings(withoutFindings)).toEqual([]);
    expect(findingsForEntity(withoutFindings, "diff-treatment")).toEqual([]);
    expect(parse(withoutFindings)).toMatchObject({ ok: true });
  });

  test("edits an exhibit without changing its intent identity", () => {
    const document = exhibitsFixture();
    const edited = updateExhibit(document, "body-declaration", {
      title: "Declared result body",
      kind: "pseudocode",
      change: "modified",
      description: "The declaration ordinary tools provide.",
      language: "typescript",
      content: 'const body = {\n  kind: "text",\n  value: String(result),\n};\n',
      source: "ToolCallMessage.tsx#ToolCallMessage",
    });

    const entity = findIntentEntity(edited, "body-declaration");
    expect(entity).toMatchObject({
      label: "Declared result body",
      change: "modified",
    });
    expect(
      entity && "exhibit" in entity && entity.exhibit.kind === "pseudocode"
        ? entity.exhibit.content
        : "",
    ).toContain("String(result)");
    expect(flowExhibit(edited, "shared-rendering-flow").connections).toEqual(
      flowExhibit(document, "shared-rendering-flow").connections,
    );
    expect(parse(edited)).toMatchObject({ ok: true });
    expect(
      updateExhibit(edited, "missing", {
        title: "Missing",
        kind: "pseudocode",
        change: "new",
        content: "noop",
      }),
    ).toBe(edited);
  });

  test("edits an option-owned exhibit at its authoritative decision option", () => {
    const document = optionExhibitsFixture();
    const edited = updateExhibit(document, "durable-state-preview", {
      title: "Restarted state preview",
      kind: "html",
      change: "new",
      content: '<section aria-label="Durable state">Restored with the active pane</section>',
    });

    expect(allDecisions(edited)[0]!.options[0]!.exhibit).toMatchObject({
      id: "durable-state-preview",
      title: "Restarted state preview",
    });
    const editedExhibit = allDecisions(edited)[0]!.options[0]!.exhibit;
    expect(
      editedExhibit?.kind === "html" && "content" in editedExhibit ? editedExhibit.content : "",
    ).toContain("active pane");
    expect(findIntentEntity(edited, "durable-state-preview")).toMatchObject({
      label: "Restarted state preview",
      owner: { kind: "decision-option", option: { id: "durable" } },
    });
    expect(allDecisions(edited)[0]!.options[1]!.exhibit).toBe(
      allDecisions(document)[0]!.options[1]!.exhibit,
    );
    expect(parse(edited)).toMatchObject({ ok: true });
  });

  test("does not reinterpret an exhibit's stable identity as another form", () => {
    const document = exhibitsFixture();
    expect(
      updateExhibit(document, "body-declaration", {
        title: "Declared result diagram",
        kind: "image",
        change: "modified",
        uri: "./result.svg",
        altText: "The declared result body.",
        source: "ToolCallMessage.tsx#ToolCallMessage",
      }),
    ).toBe(document);

    const section = document.sections.find((candidate) => candidate.id === "technical-definitions");
    if (section?.kind !== "exhibits") throw new Error("Missing exhibits section");
    section.items.push({
      id: "embedded-prototype",
      title: "Embedded prototype",
      kind: "html",
      change: "new",
      content: "<main>Prototype</main>",
    });
    expect(
      updateExhibit(document, "embedded-prototype", {
        title: "Referenced prototype",
        kind: "html",
        change: "new",
        uri: "./prototype.html",
      }),
    ).toBe(document);

    section.items.push({
      id: "target-files",
      title: "Target files",
      kind: "tree",
      type: "files",
      change: "new",
      roots: [{ kind: "file", name: "index.ts" }],
    });
    expect(
      updateExhibit(document, "target-files", {
        title: "Intent domain",
        kind: "tree",
        type: "domain",
        change: "new",
        roots: [{ name: "Intent document", children: [] }],
      }),
    ).toBe(document);
  });

  test("removes only new exhibits and repairs their entity and plan references", () => {
    const document = exhibitsFixture();
    allQuestions(document)[0]!.affects.push("body-declaration");
    document.sections.push({
      id: "exhibit-plan",
      title: "Exhibit plan",
      purpose: "Implement the declared interface.",
      collapsed: false,
      kind: "plan",
      fields: [],
      steps: [
        {
          id: "implement-declaration",
          title: "Implement the declaration",
          doneWhen: "The declared interface is verified.",
          implements: ["body-declaration"],
          values: {},
        },
      ],
    });
    expect(parse(document)).toMatchObject({ ok: true });

    const removed = removeExhibit(document, "technical-definitions", "body-declaration");
    expect(findIntentEntity(removed, "body-declaration")).toBeUndefined();
    expect(findIntentEntity(removed, "implement-declaration")).toBeUndefined();
    expect(allQuestions(removed)[0]!.affects).not.toContain("body-declaration");
    expect(planSections(removed).map((section) => section.id)).not.toContain("exhibit-plan");
    expect(parse(removed)).toMatchObject({ ok: true });

    expect(removeExhibit(document, "technical-definitions", "renderer-rollout")).toBe(document);
  });

  test("edits a plan step without changing its implementation links or identity", () => {
    const document = plannedFixture();
    const step = findIntentEntity(document, "foundation-step");
    if (step?.type !== "plan-step") throw new Error("Missing foundation step");
    step.step.status = "in-progress";
    const edited = updatePlanStep(document, "foundation-step", {
      title: "Build the durable foundation",
      doneWhen: "The durable API and its boundary tests pass.",
      values: {},
    });

    const entity = findIntentEntity(edited, "foundation-step");

    expect(entity?.type === "plan-step" ? entity.step : undefined).toMatchObject({
      id: "foundation-step",
      title: "Build the durable foundation",
      doneWhen: "The durable API and its boundary tests pass.",
      status: "in-progress",
      implements: ["durable-result"],
    });
    expect(parse(edited)).toMatchObject({ ok: true });
  });

  test("edits a step inside a named phase while preserving its phase identity", () => {
    const document = phasedPlanFixture();
    const edited = updatePlanStep(document, "integration-step", {
      title: "Integrate the durable behavior",
      doneWhen: "The complete runtime path uses the durable API.",
      values: {},
    });
    const entity = findIntentEntity(edited, "integration-step");

    expect(entity?.type === "plan-step" ? entity.phase?.title : undefined).toBe(
      "Move the runtime onto it",
    );
    expect(parse(edited)).toMatchObject({ ok: true });
  });

  test("lets an editor explicitly correct plan step status", () => {
    const document = plannedFixture();
    const step = findIntentEntity(document, "foundation-step");
    if (step?.type !== "plan-step") throw new Error("Missing foundation step");
    step.step.status = "in-progress";

    const completed = updatePlanStep(document, step.id, {
      title: step.step.title,
      doneWhen: step.step.doneWhen,
      status: "complete",
      values: step.step.values,
    });
    const completedStep = findIntentEntity(completed, step.id);
    expect(completedStep?.type === "plan-step" ? completedStep.step.status : undefined).toBe(
      "complete",
    );

    const reset = updatePlanStep(completed, step.id, {
      title: step.step.title,
      doneWhen: step.step.doneWhen,
      status: undefined,
      values: step.step.values,
    });
    const resetStep = findIntentEntity(reset, step.id);
    expect(resetStep?.type === "plan-step" ? resetStep.step.status : undefined).toBeUndefined();
    expect(parse(reset)).toMatchObject({ ok: true });
  });

  test("removes sections with their entity and tab references", () => {
    const document = fixture();
    document.tabs = [
      {
        title: "Intent",
        sections: document.sections
          .map((section) => section.id)
          .filter((id) => id !== "rendering-ownership" && id !== "shared-rendering-flow-section"),
      },
      {
        title: "Rendering",
        sections: ["rendering-ownership", "shared-rendering-flow-section"],
      },
    ];

    const withoutRecords = removeSection(document, "rendering-ownership");
    expect(withoutRecords.sections.map((section) => section.id)).not.toContain(
      "rendering-ownership",
    );
    expect(
      flowExhibit(withoutRecords, "shared-rendering-flow").paths.map((path) => path.id),
    ).toEqual(["shared-body-route"]);
    expect(
      allDecisions(withoutRecords).flatMap((decision) =>
        decision.options.flatMap((option) => option.adds),
      ),
    ).toEqual([]);
    expect(allDecisions(withoutRecords)[0]!.options[0]).not.toHaveProperty("relationships");
    expect(withoutRecords.tabs?.[1]?.sections).toEqual(["shared-rendering-flow-section"]);
    expect(parse(withoutRecords)).toMatchObject({ ok: true });

    const withoutConcepts = removeSection(withoutRecords, "concepts");
    expect(withoutConcepts.sections.map((section) => section.id)).not.toContain("concepts");
    expect(withoutConcepts.sections.map((section) => section.id)).toContain("invariants");
    expect(parse(withoutConcepts)).toMatchObject({ ok: true });

    const withoutInvariants = removeSection(withoutConcepts, "invariants");
    expect(withoutInvariants.sections.map((section) => section.id)).not.toContain("invariants");
    expect(parse(withoutInvariants)).toMatchObject({ ok: true });
  });

  test("removes plan and flow sections while preserving a valid document", () => {
    const planned = plannedFixture();
    const withoutPlan = removeSection(planned, "implementation");
    expect(planSections(withoutPlan)).toEqual([]);
    expect(
      (allDecisions(withoutPlan)[0]!.options[0]!.relationships ?? []).map(
        (relationship) => relationship.id,
      ),
    ).toEqual(["changed-causes-durable"]);
    expect(parse(withoutPlan)).toMatchObject({ ok: true });

    const document = fixture();
    const withoutFlow = removeSection(document, "shared-rendering-flow-section");
    expect(withoutFlow.sections.map((section) => section.id)).not.toContain(
      "shared-rendering-flow-section",
    );
    expect(parse(withoutFlow)).toMatchObject({ ok: true });
  });

  test("removes option exhibits and their now-orphaned plan steps with the decision section", () => {
    const document = optionExhibitsFixture();
    const removed = removeSection(document, "decisions");

    expect(findIntentEntity(removed, "durable-state-preview")).toBeUndefined();
    expect(findIntentEntity(removed, "ephemeral-state-preview")).toBeUndefined();
    expect(findIntentEntity(removed, "foundation-step")).toBeUndefined();
    expect(findIntentEntity(removed, "integration-step")).toBeDefined();
    expect(parse(removed)).toMatchObject({ ok: true });
  });

  test("removes only shared new records", () => {
    const document = fixture();
    const withoutBlock = removeRecord(document, "concepts", "block");
    expect(recordsSection(withoutBlock, "concepts").items.map((item) => item.id)).toEqual([
      "tool-call",
    ]);
    expect(removeRecord(document, "concepts", "tool-call")).toBe(document);

    const explored = selectDecisionOption(document, "diff-treatment", "shared");
    expect(removeRecord(explored, "rendering-ownership", "shared-diff")).toBe(explored);
  });

  test("removes an orphaned final plan step when its last implementation target is removed", () => {
    const document = plannedFixture();
    recordsSection(document, "behavior").items.push({
      id: "temporary-behavior",
      subject: "Temporary behavior",
      change: "new",
      values: { result: "Exists only while its plan step is needed." },
    });
    const executionPlan = plan(document, "implementation");
    if (!("steps" in executionPlan)) throw new Error("Expected flat plan");
    executionPlan.steps[1]!.implements = ["temporary-behavior"];
    expect(parse(document)).toMatchObject({ ok: true });

    const removed = removeRecord(document, "behavior", "temporary-behavior");
    expect(parse(removed)).toMatchObject({ ok: true });
    const remainingPlanSections = planSections(removed);
    expect(
      planState(remainingPlanSections, specState(removed))?.steps.map((step) => step.id),
    ).toEqual(["foundation-step"]);
  });

  test("removes a phase when its last step loses its implementation target", () => {
    const document = phasedPlanFixture();
    recordsSection(document, "behavior").items.push({
      id: "temporary-behavior",
      subject: "Temporary behavior",
      change: "new",
      values: { result: "Exists only while its plan phase is needed." },
    });
    const executionPlan = plan(document, "implementation");
    if (!("phases" in executionPlan)) throw new Error("Expected phased plan");
    executionPlan.phases[1]!.steps[0]!.implements = ["temporary-behavior"];
    expect(parse(document)).toMatchObject({ ok: true });

    const removed = removeRecord(document, "behavior", "temporary-behavior");
    const remainingPlan = plan(removed, "implementation");

    expect("phases" in remainingPlan ? remainingPlan.phases.map((phase) => phase.id) : []).toEqual([
      "foundation",
    ]);
    expect(parse(removed)).toMatchObject({ ok: true });
  });

  test("removes an orphaned step without discarding the rest of its phase", () => {
    const document = phasedPlanFixture();
    recordsSection(document, "behavior").items.push({
      id: "temporary-behavior",
      subject: "Temporary behavior",
      change: "new",
      values: { result: "Exists only while its plan step is needed." },
    });
    const executionPlan = plan(document, "implementation");
    if (!("phases" in executionPlan)) throw new Error("Expected phased plan");
    executionPlan.phases[1]!.steps.push({
      id: "temporary-step",
      title: "Implement the temporary behavior",
      doneWhen: "The temporary behavior is verified.",
      implements: ["temporary-behavior"],
      values: {},
    });
    expect(parse(document)).toMatchObject({ ok: true });

    const removed = removeRecord(document, "behavior", "temporary-behavior");
    const remainingPlan = plan(removed, "implementation");

    expect(
      "phases" in remainingPlan ? remainingPlan.phases[1]?.steps.map((step) => step.id) : [],
    ).toEqual(["integration-step"]);
    expect(parse(removed)).toMatchObject({ ok: true });
  });

  test("removes only the plan section emptied by an entity removal", () => {
    const document = plannedFixture();
    recordsSection(document, "behavior").items.push({
      id: "temporary-behavior",
      subject: "Temporary behavior",
      change: "new",
      values: { result: "Exists only for one supplemental plan section." },
    });
    document.sections.push({
      id: "supplemental-plan",
      title: "Supplemental plan",
      purpose: "Keep temporary work separate from the primary plan section.",
      collapsed: false,
      kind: "plan",
      fields: [],
      steps: [
        {
          id: "temporary-step",
          title: "Implement the temporary behavior",
          doneWhen: "The temporary behavior is verified.",
          implements: ["temporary-behavior"],
          values: {},
        },
      ],
    });
    expect(parse(document)).toMatchObject({ ok: true });

    const removed = removeRecord(document, "behavior", "temporary-behavior");
    expect(parse(removed)).toMatchObject({ ok: true });
    expect(planSections(removed).map((section) => section.id)).toEqual(["implementation"]);
    expect(findIntentEntity(removed, "temporary-step")).toBeUndefined();
  });

  test("repairs flows and plans that lose a shared requirement", () => {
    const document = structuredClone(fixture());
    document.sections.push(
      {
        id: "block-flow-section",
        title: "Follow the block",
        purpose: "Trace the proposed block into the existing tool-call model.",
        kind: "exhibits",
        collapsed: false,
        sourcePolicy: "optional",
        items: [
          {
            id: "block-flow",
            title: "Follow the block",
            description: "Trace the proposed block into the existing tool-call model.",
            change: "new",
            kind: "flow",
            nodes: [{ entity: "block" }, { entity: "tool-call" }],
            connections: [
              {
                id: "block-realizes-tool-call",
                from: "block",
                to: "tool-call",
                label: "becomes part of",
              },
            ],
            paths: [
              {
                id: "block-route",
                title: "The proposed block",
                purpose: "Follow the removable concept into the existing call.",
                start: "block",
                connectionIds: ["block-realizes-tool-call"],
              },
            ],
          },
        ],
      },
      {
        id: "block-plan",
        title: "Implement the proposed block",
        purpose: "Execute the removable flow and its shared requirement.",
        kind: "plan",
        collapsed: false,
        fields: [],
        steps: [
          {
            id: "implement-block-flow",
            title: "Implement the block flow",
            doneWhen: "The shared block follows the declared route.",
            implements: ["block-flow", "block"],
            values: {},
          },
        ],
      },
    );
    expect(parse(document)).toMatchObject({ ok: true });

    const removed = removeRecord(document, "concepts", "block");
    expect(removed.sections.map((section) => section.id)).not.toContain("block-flow-section");
    expect(removed.sections.map((section) => section.id)).not.toContain("block-plan");

    const survivingFlow = flowExhibit(removed, "shared-rendering-flow");
    expect(survivingFlow.nodes).toEqual([
      { entity: "ordinary-tools" },
      { entity: "fallback-owner" },
    ]);
    expect(survivingFlow.connections.map((connection) => connection.id)).toEqual([
      "ordinary-tools-preserve-fallback",
    ]);
    expect(survivingFlow.paths.map((path) => path.id)).toEqual(["fallback-route"]);
    expect(survivingFlow.regions).toEqual([
      { id: "ordinary-entry", title: "Ordinary tools", nodeIds: ["ordinary-tools"] },
      { id: "rendering-results", title: "Rendering results", nodeIds: ["fallback-owner"] },
    ]);
    expect(parse(removed)).toMatchObject({ ok: true });
  });
});
