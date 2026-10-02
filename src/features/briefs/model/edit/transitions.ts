import { briefEntityIds } from "../query/entities";
import { buildBriefIndex } from "../query/structure";
import { unresolvedDependencies } from "../spec";
import type {
  BriefDocument,
  BriefEntityId,
  BriefExhibit,
  BriefRecord,
  BriefSection,
  Decision,
  Finding,
  PlanStep,
  RecordsView,
} from "../schema";
import { mapEach } from "./immutable";
import { repairAfterEntityRemoval } from "./repair";

/**
 * Editor-owned immutable transitions over a `BriefDocument`: disclosure,
 * decision and question lifecycle, content updates, and reference-safe removal.
 * An update replaces an item's editable content, so omitted optional content is
 * cleared, while the item keeps its identity, grounding, and links.
 */

/** One editor transition over the current document. */
export type BriefEdit = (document: BriefDocument) => BriefDocument;

/** An entity's editable content: everything except its identity and the links an update keeps. */
type EditableContent<T, Kept extends string> = T extends unknown ? Omit<T, "id" | Kept> : never;

export type FindingUpdate = EditableContent<Finding, "exhibit">;
export type RecordUpdate = EditableContent<BriefRecord, "basedOn">;
export type ExhibitUpdate = EditableContent<BriefExhibit, "basedOn">;
export type PlanStepUpdate = EditableContent<PlanStep, "implements">;

export function setSectionsCollapsed(
  document: BriefDocument,
  sectionIds: readonly string[],
  collapsed: boolean,
): BriefDocument {
  const selected = new Set(sectionIds);
  return mapEach(document, "sections", (section) =>
    selected.has(section.id) && section.collapsed !== collapsed
      ? { ...section, collapsed }
      : section,
  );
}

export function setRecordsView(
  document: BriefDocument,
  sectionId: string,
  view: RecordsView,
): BriefDocument {
  return mapEach(document, "sections", (section) =>
    section.kind === "records" && section.id === sectionId && section.view !== view
      ? { ...section, view }
      : section,
  );
}

/** Select an option provisionally so its additions appear without claiming a decision. */
export function selectDecisionOption(
  document: BriefDocument,
  decisionId: string,
  optionId: string,
): BriefDocument {
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
export function decide(document: BriefDocument, decisionId: string): BriefDocument {
  return mapDecision(document, decisionId, (item) =>
    item.choice &&
    item.choice.status !== "decided" &&
    unresolvedDependencies(document, item).length === 0
      ? { ...item, choice: { ...item.choice, status: "decided" } }
      : item,
  );
}

/** Reopen a decided choice while retaining it for continued exploration. */
export function reopenDecision(document: BriefDocument, decisionId: string): BriefDocument {
  return mapDecision(document, decisionId, (item) =>
    item.choice && item.choice.status !== "provisional"
      ? { ...item, choice: { ...item.choice, status: "provisional" } }
      : item,
  );
}

/** Clear an explored choice and return the decision to its honest open state. */
export function clearDecisionChoice(document: BriefDocument, decisionId: string): BriefDocument {
  return mapDecision(document, decisionId, (item) => {
    if (!item.choice) return item;
    const { choice: _choice, ...open } = item;
    return open;
  });
}

/** Reopen a settled factual question without changing how it should be investigated. */
export function reopenQuestion(document: BriefDocument, questionId: string): BriefDocument {
  return mapEach(document, "sections", (section) =>
    section.kind === "questions"
      ? mapEach(section, "items", (item) => {
          if (item.id !== questionId || item.answer === undefined) return item;
          const { answer: _answer, ...open } = item;
          return open;
        })
      : section,
  );
}

/** Replace one record's editable content, whether its section or a decision option authors it. */
export function updateRecord(
  document: BriefDocument,
  recordId: string,
  update: RecordUpdate,
): BriefDocument {
  return mapEach(document, "sections", (section) => {
    if (section.kind === "records") {
      return mapEach(section, "items", (item) =>
        item.id === recordId ? { id: item.id, ...grounding(item), ...update } : item,
      );
    }
    if (section.kind !== "decisions") return section;
    return mapEach(section, "items", (decision) =>
      mapEach(decision, "options", (option) =>
        mapEach(option, "adds", (addition) =>
          addition.id === recordId
            ? { id: addition.id, sectionId: addition.sectionId, ...grounding(addition), ...update }
            : addition,
        ),
      ),
    );
  });
}

/** Replace one finding's editable content while keeping its supporting exhibit. */
export function updateFinding(
  document: BriefDocument,
  findingId: string,
  update: FindingUpdate,
): BriefDocument {
  return mapEach(document, "sections", (section) =>
    section.kind === "findings"
      ? mapEach(section, "items", (item) =>
          item.id === findingId
            ? { id: item.id, ...update, ...(item.exhibit ? { exhibit: item.exhibit } : {}) }
            : item,
        )
      : section,
  );
}

/** Replace one plan step's editable content while keeping its implementation links. */
export function updatePlanStep(
  document: BriefDocument,
  stepId: string,
  update: PlanStepUpdate,
): BriefDocument {
  const updateStep = (step: PlanStep) =>
    step.id === stepId ? { id: step.id, implements: step.implements, ...update } : step;
  return mapEach(document, "sections", (section) => {
    if (section.kind !== "plan") return section;
    return "steps" in section
      ? mapEach(section, "steps", updateStep)
      : mapEach(section, "phases", (phase) => mapEach(phase, "steps", updateStep));
  });
}

/** Replace one exhibit's editable content without reinterpreting it as another form. */
export function updateExhibit(
  document: BriefDocument,
  exhibitId: string,
  update: ExhibitUpdate,
): BriefDocument {
  const updates = (exhibit: BriefExhibit | undefined): exhibit is BriefExhibit =>
    exhibit?.id === exhibitId && hasSameExhibitForm(exhibit, update);
  const replace = (exhibit: BriefExhibit): BriefExhibit => ({
    id: exhibit.id,
    ...grounding(exhibit),
    ...update,
  });
  return mapEach(document, "sections", (section) => {
    if (section.kind === "exhibits") {
      return mapEach(section, "items", (item) => (updates(item) ? replace(item) : item));
    }
    if (section.kind !== "decisions") return section;
    return mapEach(section, "items", (decision) =>
      mapEach(decision, "options", (option) =>
        updates(option.exhibit) ? { ...option, exhibit: replace(option.exhibit) } : option,
      ),
    );
  });
}

function grounding(item: { basedOn?: string[] }): { basedOn?: string[] } {
  return item.basedOn ? { basedOn: item.basedOn } : {};
}

function hasSameExhibitForm(exhibit: BriefExhibit, update: ExhibitUpdate): boolean {
  if (exhibit.kind !== update.kind) return false;
  if (exhibit.kind === "prototype" && update.kind === "prototype") {
    return "content" in exhibit === "content" in update;
  }
  if (exhibit.kind === "tree" && update.kind === "tree") return exhibit.type === update.type;
  return true;
}

/** Whether a worker may regenerate this section without rewriting settled or derived content. */
export function canRegenerateSection(section: BriefSection): boolean {
  return !(section.kind === "plan" || section.kind === "questions" || section.kind === "decisions");
}

/**
 * Whether an editor may remove this entity: a section, a finding, or a new record
 * or exhibit authored directly in a section. Existing content describes the
 * current system, decision options own their contributions, and a brief always
 * keeps at least one section.
 */
export function canRemoveEntity(document: BriefDocument, entityId: BriefEntityId): boolean {
  const owner = document.sections.find(
    (section) => section.id === entityId || removableItemIds(section).includes(entityId),
  );
  if (!owner) return false;
  return (
    document.sections.length > 1 ||
    (owner.id !== entityId && withoutItem(owner, entityId) !== undefined)
  );
}

/** Remove one removable entity and repair every reference that cannot survive without it. */
export function removeEntity(document: BriefDocument, entityId: BriefEntityId): BriefDocument {
  if (!canRemoveEntity(document, entityId)) return document;
  const next = mapEach(document, "sections", (section) =>
    section.id === entityId ? undefined : withoutItem(section, entityId),
  );
  const remainingSectionIds = new Set(next.sections.map((section) => section.id));
  const removedSections = document.sections.filter(
    (section) => !remainingSectionIds.has(section.id),
  );
  const repaired = repairAfterEntityRemoval(
    next,
    new Set([entityId, ...briefEntityIds(buildBriefIndex(removedSections))]),
  );
  return repaired.sections.length > 0 ? repaired : document;
}

function removableItemIds(section: BriefSection): string[] {
  switch (section.kind) {
    case "findings":
      return section.items.map((item) => item.id);
    case "records":
      return section.items.flatMap((item) => (item.change === "new" ? [item.id] : []));
    case "exhibits":
      return section.items.flatMap((item) => (item.change === "new" ? [item.id] : []));
    default:
      return [];
  }
}

/** Findings and exhibits sections exist to hold items, so they leave with their last one. */
function withoutItem(section: BriefSection, itemId: string): BriefSection | undefined {
  if (section.kind !== "findings" && section.kind !== "records" && section.kind !== "exhibits") {
    return section;
  }
  const next = mapEach(section, "items", (item) => (item.id === itemId ? undefined : item));
  return next.items.length > 0 || next.kind === "records" ? next : undefined;
}

function mapDecision(
  document: BriefDocument,
  decisionId: string,
  transition: (item: Decision) => Decision,
): BriefDocument {
  return mapEach(document, "sections", (section) =>
    section.kind === "decisions"
      ? mapEach(section, "items", (item) => (item.id === decisionId ? transition(item) : item))
      : section,
  );
}
