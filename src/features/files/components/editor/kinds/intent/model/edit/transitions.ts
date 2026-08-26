import { planSteps } from "../plan/steps";
import { buildIntentIndex } from "../query/structure";
import { unresolvedDependencies } from "../spec";
import type {
  Decision,
  FindingUpdate,
  IntentDocument,
  IntentExhibit,
  IntentExhibitUpdate,
  IntentRecordUpdate,
  PlanStepUpdate,
  RecordsView,
} from "../schema";
import { repairAfterEntityRemoval } from "./repair";
import { transformSections } from "./sections";

/**
 * Editor-owned immutable transitions over an `IntentDocument`: disclosure,
 * decision and question lifecycle, editable content updates, and reference-safe
 * section and item removal.
 */

export function setSectionCollapsed(
  document: IntentDocument,
  sectionId: string,
  collapsed: boolean,
): IntentDocument {
  return transformSections(document, (section) =>
    section.id === sectionId && section.collapsed !== collapsed
      ? { ...section, collapsed }
      : section,
  );
}

export function setSectionsCollapsed(
  document: IntentDocument,
  sectionIds: readonly string[],
  collapsed: boolean,
): IntentDocument {
  const selected = new Set(sectionIds);
  return transformSections(document, (section) =>
    selected.has(section.id) && section.collapsed !== collapsed
      ? { ...section, collapsed }
      : section,
  );
}

export function setRecordsView(
  document: IntentDocument,
  sectionId: string,
  view: RecordsView,
): IntentDocument {
  return transformSections(document, (section) =>
    section.kind === "records" && section.id === sectionId && section.view !== view
      ? { ...section, view }
      : section,
  );
}

/** Select an option provisionally so its additions appear without claiming a decision. */
export function selectDecisionOption(
  document: IntentDocument,
  decisionId: string,
  optionId: string,
): IntentDocument {
  return mapDecision(document, decisionId, (item) => {
    if (
      !item.options.some((option) => option.id === optionId) ||
      item.choice?.optionId === optionId
    ) {
      return item;
    }
    return { ...item, choice: { optionId, status: "provisional" } };
  });
}

/** Commit the current provisional choice. Dependencies must be settled first. */
export function recordDecision(document: IntentDocument, decisionId: string): IntentDocument {
  return mapDecision(document, decisionId, (item) =>
    item.choice &&
    item.choice.status !== "decided" &&
    unresolvedDependencies(document, item).length === 0
      ? { ...item, choice: { ...item.choice, status: "decided" } }
      : item,
  );
}

/** Reopen a decided choice while retaining it for continued exploration. */
export function reopenDecision(document: IntentDocument, decisionId: string): IntentDocument {
  return mapDecision(document, decisionId, (item) =>
    item.choice && item.choice.status !== "provisional"
      ? { ...item, choice: { ...item.choice, status: "provisional" } }
      : item,
  );
}

/** Clear an explored choice and return the decision to its honest open state. */
export function clearDecisionChoice(document: IntentDocument, decisionId: string): IntentDocument {
  return mapDecision(document, decisionId, (item) => {
    if (!item.choice) return item;
    const { choice: _choice, ...open } = item;
    return open;
  });
}

/** Reopen a settled factual question without changing how it should be investigated. */
export function reopenQuestion(document: IntentDocument, questionId: string): IntentDocument {
  return transformSections(document, (section) => {
    if (section.kind !== "questions") return section;
    let changed = false;
    const items = section.items.map((item) => {
      if (item.id !== questionId || item.answer === undefined) return item;
      changed = true;
      const { answer: _answer, ...open } = item;
      return open;
    });
    return changed ? { ...section, items } : section;
  });
}

/** Update one record's editable content while preserving its stable intent identity. */
export function updateRecord(
  document: IntentDocument,
  recordId: string,
  update: IntentRecordUpdate,
): IntentDocument {
  return transformSections(document, (section) => {
    if (section.kind === "records") {
      let changed = false;
      const items = section.items.map((item) => {
        if (item.id !== recordId) return item;
        changed = true;
        return { ...item, ...update };
      });
      return changed ? { ...section, items } : section;
    }
    if (section.kind !== "decisions") return section;

    let changed = false;
    const items = section.items.map((decision) => {
      const options = decision.options.map((option) => {
        const adds = option.adds.map((addition) => {
          if (addition.id !== recordId) return addition;
          changed = true;
          return { ...addition, ...update };
        });
        return adds.some((addition, index) => addition !== option.adds[index])
          ? { ...option, adds }
          : option;
      });
      return options.some((option, index) => option !== decision.options[index])
        ? { ...decision, options }
        : decision;
    });
    return changed ? { ...section, items } : section;
  });
}

/** Update one settled finding while preserving its identity and supporting exhibit. */
export function updateFinding(
  document: IntentDocument,
  findingId: string,
  update: FindingUpdate,
): IntentDocument {
  return transformSections(document, (section) => {
    if (section.kind !== "findings") return section;
    let changed = false;
    const items = section.items.map((item) => {
      if (item.id !== findingId) return item;
      changed = true;
      return {
        id: item.id,
        ...update,
        ...(item.exhibit ? { exhibit: item.exhibit } : {}),
      };
    });
    return changed ? { ...section, items } : section;
  });
}

/** Update one plan step while preserving its implementation links and stable identity. */
export function updatePlanStep(
  document: IntentDocument,
  stepId: string,
  update: PlanStepUpdate,
): IntentDocument {
  let changed = false;
  const sections = document.sections.map((section) => {
    if (section.kind !== "plan") return section;
    if ("steps" in section) {
      let planChanged = false;
      const steps = section.steps.map((step) => {
        if (step.id !== stepId) return step;
        planChanged = true;
        return { ...step, ...update };
      });
      changed = changed || planChanged;
      return planChanged ? { ...section, steps } : section;
    }

    let planChanged = false;
    const phases = section.phases.map((phase) => {
      const steps = phase.steps.map((step) => {
        if (step.id !== stepId) return step;
        planChanged = true;
        return { ...step, ...update };
      });
      return steps.some((step, index) => step !== phase.steps[index]) ? { ...phase, steps } : phase;
    });
    changed = changed || planChanged;
    return planChanged ? { ...section, phases } : section;
  });
  return changed ? { ...document, sections } : document;
}

/** Update one exhibit definition while preserving its stable intent identity and form. */
export function updateExhibit(
  document: IntentDocument,
  exhibitId: string,
  update: IntentExhibitUpdate,
): IntentDocument {
  return transformSections(document, (section) => {
    if (section.kind === "exhibits") {
      let changed = false;
      const items = section.items.map((item) => {
        if (item.id !== exhibitId || !hasSameExhibitForm(item, update)) return item;
        changed = true;
        return { ...item, ...update };
      });
      return changed ? { ...section, items } : section;
    }
    if (section.kind !== "decisions") return section;

    let changed = false;
    const items = section.items.map((decision) => {
      const options = decision.options.map((option) => {
        if (option.exhibit?.id !== exhibitId || !hasSameExhibitForm(option.exhibit, update)) {
          return option;
        }
        changed = true;
        return { ...option, exhibit: { ...option.exhibit, ...update } };
      });
      return options.some((option, index) => option !== decision.options[index])
        ? { ...decision, options }
        : decision;
    });
    return changed ? { ...section, items } : section;
  });
}

/** Remove one finding and prune optional grounding references that point to it. */
export function removeFinding(
  document: IntentDocument,
  sectionId: string,
  findingId: string,
): IntentDocument {
  const section = buildIntentIndex(document.sections).findingSections.find(
    (candidate) => candidate.id === sectionId,
  );
  const finding = section?.items.find((candidate) => candidate.id === findingId);
  if (!section || !finding) return document;
  if (section.items.length === 1) return removeSection(document, sectionId);

  const withoutFinding = transformSections(document, (candidate) =>
    candidate.kind === "findings" && candidate.id === sectionId
      ? {
          ...candidate,
          items: candidate.items.filter((item) => item.id !== findingId),
        }
      : candidate,
  );
  return repairAfterEntityRemoval(withoutFinding, new Set([findingId]));
}

function hasSameExhibitForm(exhibit: IntentExhibit, update: IntentExhibitUpdate): boolean {
  if (exhibit.kind !== update.kind) return false;
  if (exhibit.kind === "html" && update.kind === "html") {
    return "content" in exhibit === "content" in update;
  }
  if (exhibit.kind === "tree" && update.kind === "tree") return exhibit.type === update.type;
  return true;
}

/** Remove one user-authored new exhibit and repair every reference to its intent identity. */
export function removeExhibit(
  document: IntentDocument,
  sectionId: string,
  exhibitId: string,
): IntentDocument {
  const section = buildIntentIndex(document.sections).exhibitSectionsById.get(sectionId);
  const exhibit = section?.items.find((candidate) => candidate.id === exhibitId);
  if (!section || !exhibit || exhibit.change !== "new") return document;

  if (section.items.length === 1) return removeSection(document, sectionId);

  const withoutExhibit = transformSections(document, (candidate) =>
    candidate.kind === "exhibits" && candidate.id === sectionId
      ? {
          ...candidate,
          items: candidate.items.filter((item) => item.id !== exhibitId),
        }
      : candidate,
  );
  return repairAfterEntityRemoval(withoutExhibit, new Set([exhibitId]));
}

/** Remove one section and every entity reference that cannot survive without it. */
export function removeSection(document: IntentDocument, sectionId: string): IntentDocument {
  const sectionIndex = document.sections.findIndex((section) => section.id === sectionId);
  if (sectionIndex < 0 || document.sections.length === 1) return document;
  const removed = document.sections[sectionIndex]!;
  const sections = document.sections.filter((_, index) => index !== sectionIndex);

  const removedIndex = buildIntentIndex([removed]);
  const removedSectionIds = new Set(removedIndex.sections.map((section) => section.id));
  const removedEntityIds = new Set([
    ...removedSectionIds,
    ...removedIndex.findings.map((item) => item.id),
    ...removedIndex.recordsSections.flatMap((section) => section.items.map((item) => item.id)),
    ...removedIndex.planSections.flatMap((section) => planSteps(section).map((step) => step.id)),
    ...removedIndex.sectionExhibits.map((item) => item.id),
    ...removedIndex.questions.map((item) => item.id),
    ...removedIndex.decisions.flatMap((item) => [
      item.id,
      ...item.options.flatMap((option) => option.adds.map((addition) => addition.id)),
      ...item.options.flatMap((option) => (option.exhibit ? [option.exhibit.id] : [])),
    ]),
  ]);
  const index = buildIntentIndex(document.sections);
  for (const addition of index.decisions.flatMap((decision) =>
    decision.options.flatMap((option) => option.adds),
  )) {
    if (removedSectionIds.has(addition.sectionId)) removedEntityIds.add(addition.id);
  }

  const next = repairAfterEntityRemoval({ ...document, sections }, removedEntityIds);
  return next.sections.length > 0 ? next : document;
}

/** Remove one user-authored new record without touching established or option-owned content. */
export function removeRecord(
  document: IntentDocument,
  sectionId: string,
  recordId: string,
): IntentDocument {
  const index = buildIntentIndex(document.sections);
  const record = index.recordsSectionsById
    .get(sectionId)
    ?.items.find((candidate) => candidate.id === recordId);
  if (!record || record.change !== "new") return document;

  const withoutRecord = transformSections(document, (section) => {
    if (section.kind !== "records" || section.id !== sectionId) return section;
    return {
      ...section,
      items: section.items.filter((candidate) => candidate.id !== recordId),
    };
  });
  return repairAfterEntityRemoval(withoutRecord, new Set([recordId]));
}

function mapDecision(
  document: IntentDocument,
  decisionId: string,
  transition: (item: Decision) => Decision,
): IntentDocument {
  return transformSections(document, (section) => {
    if (section.kind !== "decisions") return section;
    let changed = false;
    const items = section.items.map((item) => {
      if (item.id !== decisionId) return item;
      const next = transition(item);
      changed = changed || next !== item;
      return next;
    });
    return changed ? { ...section, items } : section;
  });
}
