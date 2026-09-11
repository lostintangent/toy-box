import { planStepLocations } from "../plan/steps";
import type {
  Change,
  Decision,
  DecisionOption,
  DecisionStatus,
  ExhibitsSection,
  Finding,
  FindingsSection,
  IntentDocument,
  IntentEntityId,
  IntentExhibit,
  IntentField,
  IntentRecord,
  OptionRelationship,
  IntentSection,
  OptionAddition,
  PlanPhase,
  PlanSection,
  PlanStep,
  Question,
  RecordsSection,
} from "../schema";
import { buildIntentIndex, type IntentIndex } from "./structure";

/**
 * The reader-facing projection of one document: which decision options are
 * active, what those options contribute, and how authored content resolves into
 * labelled entities and decision-owned relationships that plans and the editor share.
 */

export type ResolvedIntentTab = {
  title: string;
  sections: IntentSection[];
};

/** Resolve optional tab references without changing canonical document order. */
export function resolveIntentTabs(document: IntentDocument): ResolvedIntentTab[] {
  if (!document.tabs) {
    return [{ title: document.title, sections: document.sections }];
  }
  return document.tabs.map((tab) => ({
    title: tab.title,
    sections: document.sections.filter((section) => tab.sections.includes(section.id)),
  }));
}

export function allQuestions(document: IntentDocument): Question[] {
  return buildIntentIndex(document.sections).questions;
}

export function allDecisions(document: IntentDocument): Decision[] {
  return buildIntentIndex(document.sections).decisions;
}

export function allFindings(document: IntentDocument): Finding[] {
  return buildIntentIndex(document.sections).findings;
}

export function decisionStatus(decision: Decision): DecisionStatus {
  return decision.choice?.status ?? "open";
}

export function selectedDecisionOption(decision: Decision) {
  const optionId = decision.choice?.optionId;
  return optionId ? decision.options.find((candidate) => candidate.id === optionId) : undefined;
}

export function decisionOriginForRecord(document: IntentDocument, recordId: string) {
  for (const decision of buildIntentIndex(document.sections).decisions) {
    for (const option of decision.options) {
      if (!option.adds.some((addition) => addition.id === recordId)) continue;
      const status: DecisionStatus | "inactive" =
        decision.choice?.optionId === option.id ? decision.choice.status : "inactive";
      return {
        decision,
        option,
        status,
      };
    }
  }
}

export function findRecordsSection(
  document: IntentDocument,
  sectionId: string,
): RecordsSection | undefined {
  return buildIntentIndex(document.sections).recordsSectionsById.get(sectionId);
}

export function findExhibitsSection(
  document: IntentDocument,
  sectionId: string,
): ExhibitsSection | undefined {
  return buildIntentIndex(document.sections).exhibitSectionsById.get(sectionId);
}

export function findFindingsSection(
  document: IntentDocument,
  sectionId: string,
): FindingsSection | undefined {
  return buildIntentIndex(document.sections).findingSections.find(
    (section) => section.id === sectionId,
  );
}

export function recordLabel(item: IntentRecord | OptionAddition): string {
  return item.subject ?? item.id;
}

export function fieldValueText(field: IntentField, value: string | string[]): string {
  if (field.kind === "text") return Array.isArray(value) ? value.join(", ") : value;
  const optionIds = Array.isArray(value) ? value : [value];
  return optionIds
    .map((optionId) => field.options.find((option) => option.id === optionId)?.label ?? optionId)
    .join(", ");
}

type ActiveOption = { decision: Decision; option: Decision["options"][number] };

function activeOptions(index: IntentIndex): ActiveOption[] {
  return index.decisions.flatMap((item) => {
    const option = selectedDecisionOption(item);
    return option ? [{ decision: item, option }] : [];
  });
}

type SelectedAddition = {
  item: OptionAddition;
  decisionId: string;
  optionId: string;
  optionLabel: string;
  status: Exclude<DecisionStatus, "open">;
};

export type ProjectedRecord = {
  item: IntentRecord | OptionAddition;
  selected?: SelectedAddition;
};

export type ActiveOptionRelationship = {
  relationship: OptionRelationship;
  decisionId: string;
  optionId: string;
  optionLabel: string;
  status: Exclude<DecisionStatus, "open">;
};

type ExhibitOwner =
  | { kind: "section"; section: ExhibitsSection }
  | { kind: "decision-option"; decision: Decision; option: DecisionOption };

export function selectedAdditions(document: IntentDocument, sectionId: string): SelectedAddition[] {
  return selectedAdditionsFrom(buildIntentIndex(document.sections), sectionId);
}

export function selectedAdditionsFrom(index: IntentIndex, sectionId: string): SelectedAddition[] {
  return activeOptions(index).flatMap(({ decision: item, option }) =>
    option.adds
      .filter((addition) => addition.sectionId === sectionId)
      .map((addition) => ({
        item: addition,
        decisionId: item.id,
        optionId: option.id,
        optionLabel: option.label,
        status: item.choice!.status,
      })),
  );
}

/** Project one records section in authored or explicitly selected record order. */
export function projectedRecords(
  document: IntentDocument,
  sectionId: string,
  recordIds?: readonly string[],
): ProjectedRecord[] {
  const index = buildIntentIndex(document.sections);
  const section = index.recordsSectionsById.get(sectionId);
  if (!section) return [];
  const records: ProjectedRecord[] = [
    ...section.items.map((item) => ({ item })),
    ...selectedAdditionsFrom(index, sectionId).map((selected) => ({
      item: selected.item,
      selected,
    })),
  ];
  if (!recordIds) return records;

  const recordsById = new Map(records.map((record) => [record.item.id, record]));
  return recordIds.flatMap((recordId) => {
    const record = recordsById.get(recordId);
    return record ? [record] : [];
  });
}

/** Relationships owned by the currently active decision options. */
export function activeOptionRelationships(document: IntentDocument): ActiveOptionRelationship[] {
  return activeOptions(buildIntentIndex(document.sections)).flatMap(({ decision: item, option }) =>
    (option.relationships ?? []).map((relationship) => ({
      relationship,
      decisionId: item.id,
      optionId: option.id,
      optionLabel: option.label,
      status: item.choice!.status,
    })),
  );
}

export type IntentEntity =
  | {
      id: IntentEntityId;
      type: "section";
      label: string;
      detail: string;
      section: IntentSection;
    }
  | {
      id: IntentEntityId;
      type: "finding";
      label: string;
      detail?: string;
      finding: Finding;
      section: FindingsSection;
    }
  | {
      id: IntentEntityId;
      type: "record";
      label: string;
      detail?: string;
      change: Change;
      source?: string;
      record: IntentRecord | OptionAddition;
      section: RecordsSection;
    }
  | {
      id: IntentEntityId;
      type: "plan-step";
      label: string;
      detail?: string;
      step: PlanStep;
      phase?: PlanPhase;
      section: PlanSection;
    }
  | {
      id: IntentEntityId;
      type: "exhibit";
      label: string;
      detail?: string;
      change: Change;
      source?: string;
      exhibit: IntentExhibit;
      owner: ExhibitOwner;
    }
  | {
      id: IntentEntityId;
      type: "question";
      label: string;
      detail?: string;
      question: Question;
    }
  | {
      id: IntentEntityId;
      type: "decision";
      label: string;
      detail?: string;
      decision: Decision;
    };

export function intentEntities(document: IntentDocument): IntentEntity[] {
  return intentEntitiesFrom(buildIntentIndex(document.sections));
}

export function intentEntitiesFrom(index: IntentIndex): IntentEntity[] {
  const sectionEntities: IntentEntity[] = index.sections.map((section) => ({
    id: section.id,
    type: "section",
    label: section.title,
    detail: section.purpose,
    section,
  }));
  const sharedRecords: IntentEntity[] = index.recordsSections.flatMap((section) =>
    section.items.map((record) => recordEntity(section, record)),
  );
  const findings: IntentEntity[] = index.findingSections.flatMap((section) =>
    section.items.map((finding) => findingEntity(section, finding)),
  );
  const planStepEntities: IntentEntity[] = index.planSections.flatMap((section) =>
    planStepLocations(section).map(({ step, phase }) => planStepEntity(section, step, phase)),
  );
  const optionRecords: IntentEntity[] = index.decisions.flatMap((item) =>
    item.options.flatMap((option) =>
      option.adds.flatMap((record) => {
        const section = index.recordsSectionsById.get(record.sectionId);
        return section ? [recordEntity(section, record)] : [];
      }),
    ),
  );
  const sectionExhibits: IntentEntity[] = index.exhibitSections.flatMap((section) =>
    section.items.map((item) => exhibitEntity(item, { kind: "section", section })),
  );
  const optionExhibits: IntentEntity[] = index.decisions.flatMap((decision) =>
    decision.options.flatMap((option) =>
      option.exhibit
        ? [exhibitEntity(option.exhibit, { kind: "decision-option", decision, option })]
        : [],
    ),
  );
  const questions: IntentEntity[] = index.questions.map((item) => ({
    id: item.id,
    type: "question",
    label: item.question,
    ...(item.impact ? { detail: item.impact } : {}),
    question: item,
  }));
  const decisions: IntentEntity[] = index.decisions.map((item) => decisionEntity(item));
  return [
    ...sectionEntities,
    ...findings,
    ...sharedRecords,
    ...planStepEntities,
    ...optionRecords,
    ...sectionExhibits,
    ...optionExhibits,
    ...questions,
    ...decisions,
  ];
}

export function findingsForEntity(document: IntentDocument, entityId: IntentEntityId): Finding[] {
  const index = buildIntentIndex(document.sections);
  const entity = intentEntitiesFrom(index).find((candidate) => candidate.id === entityId);
  if (!entity) return [];
  return basedOnFindingIds(entity).flatMap((findingId) => {
    const finding = index.findingsById.get(findingId);
    return finding ? [finding] : [];
  });
}

export function entitiesGroundedByFinding(
  document: IntentDocument,
  findingId: IntentEntityId,
): IntentEntity[] {
  return intentEntities(document).filter((entity) => basedOnFindingIds(entity).includes(findingId));
}

export function findIntentEntity(
  document: IntentDocument,
  entityId: IntentEntityId,
): IntentEntity | undefined {
  const index = buildIntentIndex(document.sections);
  return intentEntitiesFrom(index).find((entity) => entity.id === entityId);
}

/** A records section reads as body text when its fields carry one summary story. */
export function recordReadingFields(section: RecordsSection) {
  const textFields = section.fields.filter((field) => field.kind === "text");
  const choiceFields = section.fields.filter((field) => field.kind === "choice");
  const summaryChoiceField =
    section.fields.length === 2 &&
    textFields.length === 1 &&
    choiceFields.length === 1 &&
    choiceFields[0]?.cardinality === "one"
      ? choiceFields[0]
      : undefined;
  const bodyField =
    textFields.length === 1 && (section.fields.length === 1 || summaryChoiceField)
      ? textFields[0]
      : undefined;
  return { bodyField, summaryChoiceField };
}

export function recordEntity(
  section: RecordsSection,
  record: IntentRecord | OptionAddition,
): IntentEntity {
  const { bodyField, summaryChoiceField } = recordReadingFields(section);
  const detail = section.fields
    .map((field) => {
      const fieldValue = record.values[field.id];
      if (fieldValue === undefined) return;
      const display = fieldValueText(field, fieldValue);
      if (field.kind === "text") return bodyField ? display : `${field.label}: ${display}`;
      return summaryChoiceField === field ? display : `${field.label}: ${display}`;
    })
    .filter((item): item is string => Boolean(item))
    .join(" · ");
  return {
    id: record.id,
    type: "record",
    label: recordLabel(record),
    ...(detail ? { detail } : {}),
    change: record.change,
    ...(record.source ? { source: record.source } : {}),
    record,
    section,
  };
}

export function findingEntity(section: FindingsSection, finding: Finding): IntentEntity {
  return {
    id: finding.id,
    type: "finding",
    label: finding.statement,
    ...(finding.whyItMatters ? { detail: finding.whyItMatters } : {}),
    finding,
    section,
  };
}

function planStepEntity(section: PlanSection, step: PlanStep, phase?: PlanPhase): IntentEntity {
  const detail = [
    step.doneWhen,
    ...section.fields.flatMap((field) => {
      const fieldValue = step.values[field.id];
      return fieldValue === undefined ? [] : [fieldValueText(field, fieldValue)];
    }),
  ].join(" · ");
  return {
    id: step.id,
    type: "plan-step",
    label: step.title,
    ...(detail ? { detail } : {}),
    step,
    ...(phase ? { phase } : {}),
    section,
  };
}

export function exhibitEntity(exhibit: IntentExhibit, owner: ExhibitOwner): IntentEntity {
  return {
    id: exhibit.id,
    type: "exhibit",
    label: exhibit.title,
    ...(exhibit.description ? { detail: exhibit.description } : {}),
    change: exhibit.change,
    ...(exhibit.source ? { source: exhibit.source } : {}),
    exhibit,
    owner,
  };
}

export function decisionEntity(item: Decision): IntentEntity {
  return {
    id: item.id,
    type: "decision",
    label: item.question,
    ...(item.rationale ? { detail: item.rationale } : {}),
    decision: item,
  };
}

function basedOnFindingIds(entity: IntentEntity): readonly string[] {
  if (entity.type === "record") return entity.record.basedOn ?? [];
  if (entity.type === "exhibit") return entity.exhibit.basedOn ?? [];
  if (entity.type === "decision") return entity.decision.basedOn ?? [];
  return [];
}
