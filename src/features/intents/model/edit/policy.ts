import type { IntentSection } from "../schema";

/** Whether a worker may regenerate this section without rewriting settled or derived content. */
export function canRegenerateSection(section: IntentSection): boolean {
  return !(section.kind === "plan" || section.kind === "questions" || section.kind === "decisions");
}
