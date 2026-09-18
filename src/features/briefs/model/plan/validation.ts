import { addDuplicateIssues, type RefinementContext } from "../issues";
import { sectionPath, type BriefIndex } from "../query/structure";
import type { BriefEntityId, BriefRecord, OptionAddition } from "../schema";
import { planStepLocations } from "./steps";

/** Validate every authored plan section and the implementation links it owns. */
export function addPlanIssues(index: BriefIndex, ctx: RefinementContext): void {
  const records = recordsById(index);
  for (const section of index.planSections) {
    const path = sectionPath(section);
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
        if (isPotentialImplementationTarget(entityId, index, records)) return;
        ctx.addIssue({
          code: "custom",
          message: `Plan step "${step.id}" can implement only Markdown/list sections, decisions with a self-contained option, or records and exhibits not marked "existing".`,
          path: [...fullPath, "implements", entityIndex],
        });
      });
    }
  }
}

function recordsById(index: BriefIndex): Map<string, BriefRecord | OptionAddition> {
  return new Map<string, BriefRecord | OptionAddition>([
    ...index.recordsSections.flatMap((section) =>
      section.items.map((record) => [record.id, record] as const),
    ),
    ...index.decisions.flatMap((decision) =>
      decision.options.flatMap((option) =>
        option.adds.flatMap((record) => {
          const section = index.recordsSectionsById.get(record.sectionId);
          return section ? ([[record.id, record]] as const) : [];
        }),
      ),
    ),
  ]);
}

function isPotentialImplementationTarget(
  entityId: BriefEntityId,
  index: BriefIndex,
  records: ReadonlyMap<string, BriefRecord | OptionAddition>,
): boolean {
  if (
    index.decisions.some(
      (decision) =>
        decision.id === entityId &&
        decision.options.some((option) => option.adds.length === 0 && !option.exhibit),
    )
  ) {
    return true;
  }
  const section = index.specSections.find((candidate) => candidate.id === entityId);
  if (section) return section.kind === "markdown" || section.kind === "list";
  const exhibit = [...index.sectionExhibits, ...index.optionExhibits].find(
    (item) => item.id === entityId,
  );
  if (exhibit) return exhibit.change !== "existing";
  const record = records.get(entityId);
  return Boolean(record && record.change !== "existing");
}
