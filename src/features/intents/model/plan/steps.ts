import { buildIntentIndex } from "../query/structure";
import type { IntentDocument, PlanPhase, PlanSection, PlanStep } from "../schema";

/**
 * The authored steps in one plan section. Flat steps preserve their order.
 * Phases are named, ordered groups whose steps also preserve authored order.
 */

type PlanStepLocation = {
  step: PlanStep;
  phase?: PlanPhase;
  path: PropertyKey[];
};

/** The top-level sections whose steps together form the document's optional plan. */
export function planSections(document: IntentDocument): readonly PlanSection[] {
  return buildIntentIndex(document.sections).planSections;
}

export function planStepLocations(section: PlanSection): PlanStepLocation[] {
  if ("steps" in section) {
    return section.steps.map((step, stepIndex) => ({
      step,
      path: ["steps", stepIndex],
    }));
  }

  return section.phases.flatMap((phase, phaseIndex) =>
    phase.steps.map((step, stepIndex) => ({
      step,
      phase,
      path: ["phases", phaseIndex, "steps", stepIndex],
    })),
  );
}

export function planSteps(section: PlanSection): readonly PlanStep[] {
  return "steps" in section ? section.steps : section.phases.flatMap((phase) => phase.steps);
}
