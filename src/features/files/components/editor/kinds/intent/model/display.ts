import { intentMapGraph } from "./maps";
import { selectedAdditions } from "./projection";
import { workItems } from "./sequence";
import type { IntentDefinition, IntentSection, LeafSection } from "./schema";

/**
 * Section disclosure policy: how much a collapsed section is holding, and which
 * sections a worker may safely refresh without rewriting authored workflow or
 * derived readings.
 */

export function sectionItemCount(
  definition: IntentDefinition,
  section: IntentSection | LeafSection,
): number {
  if (section.kind === "group") {
    return section.sections.reduce(
      (total, child) => total + sectionItemCount(definition, child),
      0,
    );
  }
  if (section.kind === "map") return intentMapGraph(definition, section).stages.flat().length;
  if (section.kind === "prose") return 1;
  if (section.kind === "list") return section.items.length;
  if (section.kind === "records") {
    return section.items.length + selectedAdditions(definition, section.id).length;
  }
  if (section.kind === "sequence") return workItems(section).length;
  return section.items.length;
}

export function sectionCanRefresh(section: IntentSection | LeafSection): boolean {
  if (
    section.kind === "map" ||
    section.kind === "sequence" ||
    section.kind === "questions" ||
    section.kind === "decisions"
  ) {
    return false;
  }
  if (section.kind === "group") {
    return section.sections.every(
      (child) =>
        child.kind !== "sequence" && child.kind !== "questions" && child.kind !== "decisions",
    );
  }
  return true;
}
