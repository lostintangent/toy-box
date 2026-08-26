import { describe, expect, test } from "bun:test";
import { activeOptionRelationships, allDecisions } from "../query/reading";
import type { IntentDocument } from "../schema";
import { specState } from "../spec";
import {
  optionExhibitsFixture,
  parse,
  phasedPlanFixture,
  plan,
  plannedFixture,
} from "../testFixtures";
import { planState, planStatus } from "./state";
import { planSections, planSteps } from "./steps";

function derivedPlanState(document: IntentDocument) {
  return planState(planSections(document), specState(document));
}

describe("intent plan", () => {
  test("owns implementation links, phases, and step identity", () => {
    expect(parse(plannedFixture())).toMatchObject({ ok: true });

    const unlinkedStep = structuredClone(plannedFixture());
    const unlinkedPlan = plan(unlinkedStep, "implementation");
    if (!("steps" in unlinkedPlan)) throw new Error("Expected flat plan");
    unlinkedPlan.steps[0]!.implements = [];
    expect(parse(unlinkedStep)).toMatchObject({ ok: false });

    const invalidTarget = structuredClone(plannedFixture());
    const invalidPlan = plan(invalidTarget, "implementation");
    if (!("steps" in invalidPlan)) throw new Error("Expected flat plan");
    invalidPlan.steps[0]!.implements = ["unknown-entity"];
    expect(parse(invalidTarget)).toMatchObject({
      ok: false,
      error: expect.stringContaining("records and exhibits not marked"),
    });

    const decisionWithoutStandaloneOutcome = structuredClone(plannedFixture());
    const decisionPlan = plan(decisionWithoutStandaloneOutcome, "implementation");
    if (!("steps" in decisionPlan)) throw new Error("Expected flat plan");
    decisionPlan.steps[0]!.implements = ["durability-policy"];
    expect(parse(decisionWithoutStandaloneOutcome)).toMatchObject({ ok: false });

    allDecisions(decisionWithoutStandaloneOutcome)[0]!.options.push({
      id: "keep-current-policy",
      label: "Keep the current policy",
      adds: [],
    });
    expect(parse(decisionWithoutStandaloneOutcome)).toMatchObject({ ok: true });

    const duplicateLink = structuredClone(plannedFixture());
    const duplicatePlan = plan(duplicateLink, "implementation");
    if (!("steps" in duplicatePlan)) throw new Error("Expected flat plan");
    duplicatePlan.steps[0]!.implements.push(duplicatePlan.steps[0]!.implements[0]!);
    expect(parse(duplicateLink)).toMatchObject({ ok: false });

    const phased = phasedPlanFixture();
    expect(planSteps(plan(phased, "implementation")).map((step) => step.id)).toEqual([
      "foundation-step",
      "integration-step",
    ]);
    const reordered = structuredClone(phased);
    const reorderedPlan = plan(reordered, "implementation");
    if (!("phases" in reorderedPlan)) throw new Error("Expected phased plan");
    reorderedPlan.phases.reverse();
    expect(parse(reordered)).toMatchObject({ ok: true });

    const duplicatePhase = structuredClone(phased);
    const duplicatePhasePlan = plan(duplicatePhase, "implementation");
    if (!("phases" in duplicatePhasePlan)) throw new Error("Expected phased plan");
    duplicatePhasePlan.phases[1]!.id = duplicatePhasePlan.phases[0]!.id;
    expect(parse(duplicatePhase)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Phases in"),
    });

    const leakedPlanRelationship = structuredClone(plannedFixture());
    allDecisions(leakedPlanRelationship)[0]!.options[0]!.relationships!.push({
      id: "behavior-depends-on-foundation-step",
      from: "changed-behavior",
      to: "foundation-step",
      kind: "depends-on",
    });
    expect(parse(leakedPlanRelationship)).toMatchObject({ ok: false });
  });

  test("derives current steps, complete planning, and status against the spec", () => {
    const document = plannedFixture();
    const state = derivedPlanState(document);
    expect(state).toMatchObject({
      fullyPlanned: true,
      status: "not-started",
      canExecute: true,
      unplannedRequirements: [],
    });
    expect(state).not.toHaveProperty("requirements");
    expect(state?.steps.map((step) => step.id)).toEqual(["foundation-step", "integration-step"]);
    expect(state?.targetsByStepId.get("integration-step")?.map((entity) => entity.id)).toEqual([
      "changed-behavior",
    ]);
    expect(activeOptionRelationships(document).map(({ relationship }) => relationship.id)).toEqual([
      "changed-causes-durable",
    ]);
  });

  test("derives one plan from multiple plan sections in document order", () => {
    const document = phasedPlanFixture();
    const foundationSection = plan(document, "implementation");
    if (!("phases" in foundationSection)) throw new Error("Expected phased plan");
    const integrationPhase = foundationSection.phases.pop();
    if (!integrationPhase) throw new Error("Missing integration phase");
    foundationSection.phases[0]!.steps[0]!.status = "complete";
    integrationPhase.id = foundationSection.phases[0]!.id;
    document.sections.push({
      id: "integration-plan",
      title: "Integration plan",
      purpose: "Keep integration work in its own authored section.",
      kind: "plan",
      collapsed: false,
      fields: [],
      phases: [integrationPhase],
    });

    const parsed = parse(document);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;

    const sections = planSections(parsed.value);
    const state = planState(sections, specState(parsed.value));
    expect(sections.map((section) => section.id)).toEqual(["implementation", "integration-plan"]);
    expect(
      sections.map((section) => ("phases" in section ? section.phases[0]?.id : undefined)),
    ).toEqual(["foundation", "foundation"]);
    expect(state?.steps.map((step) => step.id)).toEqual(["foundation-step", "integration-step"]);
    expect(state).toMatchObject({ fullyPlanned: true, status: "in-progress", canExecute: true });
  });

  test("treats changed exhibits as requirements a plan step can implement", () => {
    const document = structuredClone(plannedFixture());
    document.sections.push({
      id: "migration-interface",
      title: "Migration interface",
      purpose: "Define the command-line interface the foundation step must provide.",
      kind: "exhibits",
      collapsed: false,
      sourcePolicy: "optional",
      items: [
        {
          id: "migration-command",
          title: "Migration command",
          kind: "pseudocode",
          change: "new",
          language: "bash",
          content: "toy-box migrate --durable-state",
        },
      ],
    });
    const executionPlan = plan(document, "implementation");
    if (!("steps" in executionPlan)) throw new Error("Expected flat plan");
    executionPlan.steps[0]!.implements.push("migration-command");
    const parsed = parse(document);
    if (!parsed.ok) throw new Error(parsed.error);

    const state = derivedPlanState(parsed.value);
    expect(state?.fullyPlanned).toBe(true);
    expect(
      state?.targetsByStepId
        .get("foundation-step")
        ?.some((entity) => entity.type === "exhibit" && entity.id === "migration-command"),
    ).toBe(true);
  });

  test("keeps plans for option exhibits dormant until that option is decided", () => {
    const document = optionExhibitsFixture();

    const openState = derivedPlanState(document);
    expect(openState?.steps.map((step) => step.id)).toEqual(["integration-step"]);
    expect(openState?.targetsByStepId.has("foundation-step")).toBe(false);

    allDecisions(document)[0]!.choice = { optionId: "durable", status: "decided" };
    const decidedState = derivedPlanState(document);
    expect(
      decidedState?.targetsByStepId.get("foundation-step")?.map((entity) => entity.id),
    ).toEqual(["durable-result", "durable-state-preview"]);
    expect(decidedState).toMatchObject({ fullyPlanned: true, canExecute: true });
  });

  test("lets a plan implement a flow and its shared requirements independently", () => {
    const document = structuredClone(plannedFixture());
    document.sections.push({
      id: "behavior-flow-section",
      title: "Behavior flow",
      purpose: "Define how the shared requirements connect.",
      kind: "exhibits",
      collapsed: false,
      sourcePolicy: "optional",
      items: [
        {
          id: "behavior-flow",
          title: "Durable behavior flow",
          kind: "flow",
          change: "modified",
          nodes: [{ entity: "changed-behavior" }, { entity: "durable-result" }],
          connections: [
            {
              id: "behavior-produces-durable-result",
              from: "changed-behavior",
              to: "durable-result",
              label: "produces",
            },
          ],
          paths: [
            {
              id: "durable-path",
              title: "Persist the result",
              purpose: "Follow the changed behavior into its durable result.",
              start: "changed-behavior",
              connectionIds: ["behavior-produces-durable-result"],
            },
          ],
        },
      ],
    });
    const executionPlan = plan(document, "implementation");
    if (!("steps" in executionPlan)) throw new Error("Expected flat plan");
    executionPlan.steps[1]!.implements.push("behavior-flow");

    const parsed = parse(document);
    if (!parsed.ok) throw new Error(parsed.error);
    const state = derivedPlanState(parsed.value);

    expect(state).toMatchObject({ fullyPlanned: true, canExecute: true });
    expect(state?.targetsByStepId.get("foundation-step")?.map((entity) => entity.id)).toEqual([
      "durable-result",
    ]);
    expect(state?.targetsByStepId.get("integration-step")?.map((entity) => entity.id)).toEqual([
      "changed-behavior",
      "behavior-flow",
    ]);
  });

  test("lets markdown guide a step without becoming a requirement", () => {
    const document = structuredClone(plannedFixture());
    document.sections.unshift({
      id: "execution-guidance",
      title: "Execution guidance",
      purpose: "Keep a concise implementation boundary visible.",
      kind: "markdown",
      collapsed: false,
      body: "Keep the durable API independent from transcript presentation.",
    });
    const executionPlan = plan(document, "implementation");
    if (!("steps" in executionPlan)) throw new Error("Expected flat plan");
    executionPlan.steps[0]!.implements.push("execution-guidance");
    const parsed = parse(document);
    if (!parsed.ok) throw new Error(parsed.error);

    const state = derivedPlanState(parsed.value);
    expect(specState(parsed.value).requirements.map((entity) => entity.id)).not.toContain(
      "execution-guidance",
    );
    expect(state?.targetsByStepId.get("foundation-step")?.map((entity) => entity.id)).toContain(
      "execution-guidance",
    );
    expect(state?.fullyPlanned).toBe(true);
  });

  test("keeps only steps that implement the current spec", () => {
    const document = plannedFixture();
    const decision = allDecisions(document)[0]!;
    decision.choice!.status = "provisional";

    const state = derivedPlanState(document);
    expect(state?.steps.map((step) => step.id)).toEqual(["integration-step"]);
    expect(state).toMatchObject({ fullyPlanned: true, unplannedRequirements: [] });
  });

  test("derives plan and phase status from step status", () => {
    const document = plannedFixture();
    const executionPlan = plan(document, "implementation");
    if (!("steps" in executionPlan)) throw new Error("Expected flat plan");
    expect(planStatus(executionPlan.steps)).toBe("not-started");

    executionPlan.steps[0]!.status = "complete";
    expect(planStatus(executionPlan.steps)).toBe("in-progress");
    expect(derivedPlanState(document)?.status).toBe("in-progress");

    executionPlan.steps[1]!.status = "in-progress";
    expect(planStatus(executionPlan.steps)).toBe("in-progress");

    executionPlan.steps[1]!.status = "complete";
    expect(planStatus(executionPlan.steps)).toBe("complete");
    expect(derivedPlanState(document)).toMatchObject({
      fullyPlanned: true,
      status: "complete",
      canExecute: false,
    });
  });

  test("represents no plan with absence instead of a synthetic status", () => {
    const document = plannedFixture();
    document.sections = document.sections.filter((section) => section.kind !== "plan");
    const parsed = parse(document);
    if (!parsed.ok) throw new Error(parsed.error);

    expect(specState(parsed.value).settled).toBe(true);
    expect(planSections(parsed.value)).toEqual([]);
  });

  test("keeps complete planning separate from spec settlement", () => {
    const document = structuredClone(plannedFixture());
    const behavior = document.sections.find((section) => section.id === "behavior");
    if (!behavior || behavior.kind !== "records") throw new Error("Missing behavior records");
    behavior.items.push({
      id: "unplanned-behavior",
      subject: "Unplanned behavior",
      change: "new",
      values: { result: "Still needs a plan step." },
    });
    const parsed = parse(document);
    if (!parsed.ok) throw new Error(parsed.error);

    expect(specState(parsed.value).settled).toBe(true);
    expect(derivedPlanState(parsed.value)).toMatchObject({
      fullyPlanned: false,
      status: "not-started",
      canExecute: false,
      unplannedRequirements: [{ id: "unplanned-behavior" }],
    });
  });

  test("derives executability from spec settlement and a fully planned spec", () => {
    const document = plannedFixture();
    const decision = allDecisions(document)[0]!;
    decision.choice!.status = "provisional";

    expect(specState(document).settled).toBe(false);
    expect(derivedPlanState(document)).toMatchObject({
      fullyPlanned: true,
      status: "not-started",
      canExecute: false,
    });
  });
});
