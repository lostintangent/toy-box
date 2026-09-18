import type { BriefSection } from "../schema";

/** Whether a worker may regenerate this section without rewriting settled or derived content. */
export function canRegenerateSection(section: BriefSection): boolean {
  return !(section.kind === "plan" || section.kind === "questions" || section.kind === "decisions");
}
