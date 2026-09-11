import type { IntentDocument, IntentSection } from "../schema";

type AnySectionTransition = <Section extends IntentSection>(section: Section) => Section;

/** Apply one immutable transformation to every authored section. */
export function transformSections(
  document: IntentDocument,
  transition: AnySectionTransition,
): IntentDocument {
  let changed = false;
  const sections = document.sections.map((section) => {
    const next = transition(section);
    changed = changed || next !== section;
    return next;
  });
  return changed ? { ...document, sections } : document;
}
