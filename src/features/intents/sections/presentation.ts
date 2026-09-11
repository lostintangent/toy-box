import {
  planSteps,
  selectedAdditions,
  type IntentDocument,
  type IntentSection,
} from "../model/index";

/** Count the authored or projected items summarized by one section's chrome. */
export function countSectionItems(document: IntentDocument, section: IntentSection): number {
  if (section.kind === "markdown") return 1;
  if (section.kind === "list") return section.items.length;
  if (section.kind === "records") {
    return section.items.length + selectedAdditions(document, section.id).length;
  }
  if (section.kind === "plan") return planSteps(section).length;
  return section.items.length;
}
