import type { IntentEntity } from "../query/reading";
import type { PlanSection, PlanStep, PlanStepStatus } from "../schema";
import type { SpecState } from "../spec";
import { planSteps } from "./steps";

/** The lifecycle status derived from the plan steps for the current spec. */
export type PlanStatus = "not-started" | PlanStepStatus;

export type PlanState = {
  steps: PlanStep[];
  targetsByStepId: ReadonlyMap<string, IntentEntity[]>;
  unplannedRequirements: IntentEntity[];
  fullyPlanned: boolean;
  status: PlanStatus;
  canExecute: boolean;
};

/**
 * Evaluate every authored plan section as one plan against the effective spec.
 * The spec owns settlement and requirements; PlanState derives current steps,
 * unplanned requirements, lifecycle status, and whether execution is possible.
 */
export function planState(
  planSections: readonly PlanSection[],
  spec: SpecState,
): PlanState | undefined {
  if (planSections.length === 0) return undefined;

  const requirementIds = new Set(spec.requirements.map((entity) => entity.id));
  const specEntitiesById = new Map(
    [...spec.guidance, ...spec.requirements].map((entity) => [entity.id, entity]),
  );
  const targetsByStepId = new Map<string, IntentEntity[]>();
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
