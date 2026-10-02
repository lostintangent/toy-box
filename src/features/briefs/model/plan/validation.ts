import { addDuplicateIssues, sectionPath, type RefinementContext } from "../issues";
import { briefEntitiesFrom, type BriefEntity } from "../query/entities";
import { isSelfContainedOption } from "../query/options";
import { isDescriptionSection, type BriefIndex } from "../query/structure";
import { planStepLocations } from "./steps";

/** Validate every authored plan section and the implementation links it owns. */
export function addPlanIssues(index: BriefIndex, ctx: RefinementContext): void {
  const entities = new Map(briefEntitiesFrom(index).map((entity) => [entity.id, entity]));
  for (const section of index.planSections) {
    const path = sectionPath(section.id);
    if ("phases" in section) {
      addDuplicateIssues(
        section.phases.map((phase) => phase.id),
        ctx,
        [...path, "phases"],
        `Phases in "${section.title}"`,
      );
    }

    for (const { step, path: stepPath } of planStepLocations(section)) {
      const fullPath = [...path, ...stepPath];
      addDuplicateIssues(
        step.implements,
        ctx,
        [...fullPath, "implements"],
        `Implementation links for "${step.title}"`,
      );
      step.implements.forEach((entityId, entityIndex) => {
        if (isImplementationTarget(entities.get(entityId))) return;
        ctx.addIssue({
          code: "custom",
          message: `Plan step "${step.id}" can implement only Markdown/list sections, decisions with a self-contained option, or records and exhibits not marked "existing".`,
          path: [...fullPath, "implements", entityIndex],
        });
      });
    }
  }
}

function isImplementationTarget(entity: BriefEntity | undefined): boolean {
  switch (entity?.type) {
    case "section":
      return isDescriptionSection(entity.section);
    case "decision":
      return entity.decision.options.some(isSelfContainedOption);
    case "record":
    case "exhibit":
      return entity.change !== "existing";
    default:
      return false;
  }
}
