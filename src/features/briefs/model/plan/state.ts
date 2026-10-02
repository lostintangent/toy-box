import type { BriefEntity } from "../query/entities";
import { buildBriefIndex } from "../query/structure";
import type { BriefDocument, PlanStep, PlanStepStatus } from "../schema";
import type { SpecState } from "../spec";
import { planSteps } from "./steps";

/** The lifecycle status derived from the plan steps for the current spec. */
export type PlanStatus = "not-started" | PlanStepStatus;

export type PlanState = {
  steps: PlanStep[];
  targetsByStepId: ReadonlyMap<string, BriefEntity[]>;
  unplannedRequirements: BriefEntity[];
  fullyPlanned: boolean;
  status: PlanStatus;
  canExecute: boolean;
};

/**
 * Evaluate a document's plan sections as one plan against its effective spec.
 * The spec owns settlement and requirements; PlanState derives current steps,
 * unplanned requirements, lifecycle status, and whether execution is possible.
 */
export function planState(document: BriefDocument, spec: SpecState): PlanState | undefined {
  const { planSections } = buildBriefIndex(document.sections);
  if (planSections.length === 0) return undefined;

  const requirementIds = new Set(spec.requirements.map((entity) => entity.id));
  const specEntitiesById = new Map(
    [...spec.guidance, ...spec.requirements].map((entity) => [entity.id, entity]),
  );
  const targetsByStepId = new Map<string, BriefEntity[]>();
  const steps: PlanStep[] = [];

  for (const section of planSections) {
    for (const step of planSteps(section)) {
      const targets = step.implements.flatMap((entityId) => {
        const entity = specEntitiesById.get(entityId);
        return entity ? [entity] : [];
      });
      if (targets.length === 0) continue;
      targetsByStepId.set(step.id, targets);
      steps.push(step);
    }
  }

  const plannedRequirementIds = new Set(
    steps.flatMap((step) => step.implements.filter((entityId) => requirementIds.has(entityId))),
  );
  const unplannedRequirements = spec.requirements.filter(
    (entity) => !plannedRequirementIds.has(entity.id),
  );
  const fullyPlanned = steps.length > 0 && unplannedRequirements.length === 0;
  const status = planStatus(steps);

  return {
    steps,
    targetsByStepId,
    unplannedRequirements,
    fullyPlanned,
    status,
    canExecute: spec.settled && fullyPlanned && status !== "complete",
  };
}

export function planStatus(steps: readonly PlanStep[]): PlanStatus {
  if (steps.length > 0 && steps.every((step) => step.status === "complete")) return "complete";
  if (steps.some((step) => step.status !== undefined)) return "in-progress";
  return "not-started";
}

/**
 * Whether the plan is executing now, given whether an execution was requested and whether the
 * document's owning agent is active. That agent may execute the plan without a request, so its
 * activity counts once the plan has started; before then, unrelated activity such as authoring
 * the brief must not block a first run. A started plan with neither signal was interrupted.
 */
export function planExecuting(
  plan: PlanState | undefined,
  { requested, ownerActive }: { requested: boolean; ownerActive: boolean },
): boolean {
  return requested || (ownerActive && plan?.status === "in-progress");
}
