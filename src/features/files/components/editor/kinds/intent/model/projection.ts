import { buildIntentIndex, type IntentIndex } from "./read";
import { workItemEntries } from "./sequence";
import type {
  Change,
  Decision,
  ExhibitsSection,
  IntentDefinition,
  IntentEntityId,
  IntentExhibit,
  IntentField,
  IntentRecord,
  IntentRelation,
  IntentSection,
  OptionAddition,
  Question,
  RecordsSection,
  SequenceSection,
  SequenceStage,
  WorkItem,
} from "./schema";

/**
 * The reader-facing projection of one definition: which decision options are
 * active, what those options contribute, and how authored content resolves into
 * labelled entities and relationships that maps, plans, and the editor share.
 */

export function allQuestions(definition: IntentDefinition): Question[] {
  return buildIntentIndex(definition.sections).questions;
}

export function allDecisions(definition: IntentDefinition): Decision[] {
  return buildIntentIndex(definition.sections).decisions;
}

export function recordDecisionOrigin(definition: IntentDefinition, recordId: string) {
  for (const decision of buildIntentIndex(definition.sections).decisions) {
    for (const option of decision.options) {
      if (!option.adds.some((addition) => addition.id === recordId)) continue;
      const status: Decision["status"] | "inactive" =
        decision.chosen === option.id ? decision.status : "inactive";
      return {
        decision,
        option,
        status,
      };
    }
  }
}

export function findRecordsSection(
  definition: IntentDefinition,
  sectionId: string,
): RecordsSection | undefined {
  return buildIntentIndex(definition.sections).recordsSectionsById.get(sectionId);
}

export function findExhibitsSection(
  definition: IntentDefinition,
  sectionId: string,
): ExhibitsSection | undefined {
  return buildIntentIndex(definition.sections).exhibitSectionsById.get(sectionId);
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
    if (item.status === "open") return [];
    const option = item.chosen
      ? item.options.find((candidate) => candidate.id === item.chosen)
      : undefined;
    return option ? [{ decision: item, option }] : [];
  });
}

type SelectedAddition = {
  item: OptionAddition;
  decisionId: string;
  optionId: string;
  optionLabel: string;
  status: Exclude<Decision["status"], "open">;
};

export type ProjectedRecord = {
  item: IntentRecord | OptionAddition;
  selected?: SelectedAddition;
};

export type EffectiveRelation = {
  relation: IntentRelation;
  decisionId?: string;
  optionId?: string;
  optionLabel?: string;
  status?: Exclude<Decision["status"], "open">;
};

export function selectedAdditions(
  definition: IntentDefinition,
  sectionId: string,
): SelectedAddition[] {
  return selectedAdditionsFrom(buildIntentIndex(definition.sections), sectionId);
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
        status: item.status === "decided" ? "decided" : "provisional",
      })),
  );
}

/** Project one records section in authored or explicitly selected record order. */
export function projectedRecords(
  definition: IntentDefinition,
  sectionId: string,
  recordIds?: readonly string[],
): ProjectedRecord[] {
  const index = buildIntentIndex(definition.sections);
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

export function effectiveRelations(definition: IntentDefinition): EffectiveRelation[] {
  return effectiveRelationsFrom(definition, buildIntentIndex(definition.sections));
}

export function effectiveRelationsFrom(
  definition: IntentDefinition,
  index: IntentIndex,
): EffectiveRelation[] {
  return [
    ...definition.relations.map((relation) => ({ relation })),
    ...activeOptions(index).flatMap(({ decision: item, option }) =>
      option.relations.map((relation) => ({
        relation,
        decisionId: item.id,
        optionId: option.id,
        optionLabel: option.label,
        status: item.status === "decided" ? ("decided" as const) : ("provisional" as const),
      })),
    ),
  ];
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
      type: "record";
      label: string;
      detail?: string;
      change: Change;
      provenance?: string;
      record: IntentRecord | OptionAddition;
      section: RecordsSection;
    }
  | {
      id: IntentEntityId;
      type: "work";
      label: string;
      detail?: string;
      work: WorkItem;
      stage?: SequenceStage;
      section: SequenceSection;
    }
  | {
      id: IntentEntityId;
      type: "exhibit";
      label: string;
      detail?: string;
      change: Change;
      provenance?: string;
      exhibit: IntentExhibit;
      section: ExhibitsSection;
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

export type IntentWorkEntity = Extract<IntentEntity, { type: "work" }>;

export function intentEntities(definition: IntentDefinition): IntentEntity[] {
  return intentEntitiesFrom(buildIntentIndex(definition.sections));
}

export function intentEntitiesFrom(index: IntentIndex): IntentEntity[] {
  const sections: IntentEntity[] = index.sections.map((section) => ({
    id: section.id,
    type: "section",
    label: section.title,
    detail: section.purpose,
    section,
  }));
  const sharedRecords: IntentEntity[] = index.recordsSections.flatMap((section) =>
    section.items.map((record) => recordEntity(section, record)),
  );
  const work: IntentEntity[] = index.sequences.flatMap((section) =>
    workItemEntries(section).map(({ item, stage }) => workEntity(section, item, stage)),
  );
  const optionRecords: IntentEntity[] = index.decisions.flatMap((item) =>
    item.options.flatMap((option) =>
      option.adds.flatMap((record) => {
        const section = index.recordsSectionsById.get(record.sectionId);
        return section ? [recordEntity(section, record)] : [];
      }),
    ),
  );
  const exhibits: IntentEntity[] = index.exhibitSections.flatMap((section) =>
    section.items.map((item) => exhibitEntity(section, item)),
  );
  const questions: IntentEntity[] = index.questions.map((item) => ({
    id: item.id,
    type: "question",
    label: item.question,
    ...(item.effect ? { detail: item.effect } : {}),
    question: item,
  }));
  const decisions: IntentEntity[] = index.decisions.map((item) => decisionEntity(item));
  return [
    ...sections,
    ...sharedRecords,
    ...work,
    ...optionRecords,
    ...exhibits,
    ...questions,
    ...decisions,
  ];
}

export function findIntentEntity(
  definition: IntentDefinition,
  entityId: IntentEntityId,
): IntentEntity | undefined {
  const index = buildIntentIndex(definition.sections);
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
    ...(record.provenance ? { provenance: record.provenance } : {}),
    record,
    section,
  };
}

function workEntity(section: SequenceSection, item: WorkItem, stage?: SequenceStage): IntentEntity {
  const detail = section.fields
    .map((field) => {
      const fieldValue = item.values[field.id];
      if (fieldValue === undefined) return;
      return fieldValueText(field, fieldValue);
    })
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  return {
    id: item.id,
    type: "work",
    label: item.title,
    ...(detail ? { detail } : {}),
    work: item,
    ...(stage ? { stage } : {}),
    section,
  };
}

export function exhibitEntity(section: ExhibitsSection, exhibit: IntentExhibit): IntentEntity {
  return {
    id: exhibit.id,
    type: "exhibit",
    label: exhibit.title,
    ...(exhibit.description ? { detail: exhibit.description } : {}),
    change: exhibit.change,
    ...(exhibit.provenance ? { provenance: exhibit.provenance } : {}),
    exhibit,
    section,
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
