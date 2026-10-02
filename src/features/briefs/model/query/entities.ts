import { planStepLocations, planSteps } from "../plan/steps";
import type {
  Change,
  Decision,
  DecisionOption,
  ExhibitsSection,
  Finding,
  FindingsSection,
  BriefDocument,
  BriefEntityId,
  BriefExhibit,
  BriefField,
  BriefRecord,
  BriefSection,
  PlanPhase,
  PlanSection,
  PlanStep,
  Question,
  RecordsSection,
} from "../schema";
import { buildBriefIndex, type BriefIndex } from "./structure";

/**
 * The labelled entities that specs, plans, flows, and the editor share: every
 * authored identity, the entity it resolves to, and how that entity reads in
 * one line.
 */

type ExhibitOwner =
  | { kind: "section"; section: ExhibitsSection }
  | { kind: "decision-option"; decision: Decision; option: DecisionOption };

/** What every brief entity shares: its identity and how it reads in one line. */
type EntityLabel = { id: BriefEntityId; label: string; detail?: string };

export type BriefEntity = EntityLabel &
  (
    | { type: "section"; section: BriefSection }
    | { type: "finding"; finding: Finding; section: FindingsSection }
    | {
        type: "record";
        change: Change;
        source?: string;
        record: BriefRecord;
        section: RecordsSection;
      }
    | { type: "plan-step"; step: PlanStep; phase?: PlanPhase; section: PlanSection }
    | {
        type: "exhibit";
        change: Change;
        source?: string;
        exhibit: BriefExhibit;
        owner: ExhibitOwner;
      }
    | { type: "question"; question: Question }
    | { type: "decision"; decision: Decision }
  );

export function briefEntities(document: BriefDocument): BriefEntity[] {
  return briefEntitiesFrom(buildBriefIndex(document.sections));
}

export function briefEntitiesFrom(index: BriefIndex): BriefEntity[] {
  const sectionEntities = index.sections.map(sectionEntity);
  const sharedRecords: BriefEntity[] = index.recordsSections.flatMap((section) =>
    section.items.map((record) => recordEntity(section, record)),
  );
  const findings: BriefEntity[] = index.findingSections.flatMap((section) =>
    section.items.map((finding) => findingEntity(section, finding)),
  );
  const planStepEntities: BriefEntity[] = index.planSections.flatMap((section) =>
    planStepLocations(section).map(({ step, phase }) => planStepEntity(section, step, phase)),
  );
  const optionRecords: BriefEntity[] = index.decisions.flatMap((item) =>
    item.options.flatMap((option) =>
      option.adds.flatMap((record) => {
        const section = index.recordsSectionsById.get(record.sectionId);
        return section ? [recordEntity(section, record)] : [];
      }),
    ),
  );
  const sectionExhibits: BriefEntity[] = index.exhibitSections.flatMap((section) =>
    section.items.map((item) => exhibitEntity(item, { kind: "section", section })),
  );
  const optionExhibits: BriefEntity[] = index.decisions.flatMap((decision) =>
    decision.options.flatMap((option) =>
      option.exhibit
        ? [exhibitEntity(option.exhibit, { kind: "decision-option", decision, option })]
        : [],
    ),
  );
  const questions = index.questions.map(questionEntity);
  const decisions = index.decisions.map(decisionEntity);
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

export function findBriefEntity(
  document: BriefDocument,
  entityId: BriefEntityId,
): BriefEntity | undefined {
  const index = buildBriefIndex(document.sections);
  return briefEntitiesFrom(index).find((entity) => entity.id === entityId);
}

/** Every authored identity, including finding exhibits and decision-option contributions. */
export function briefEntityIds(index: BriefIndex): BriefEntityId[] {
  return [
    ...index.sections.map((section) => section.id),
    ...index.findings.map((item) => item.id),
    ...index.findings.flatMap((item) => (item.exhibit ? [item.exhibit.id] : [])),
    ...index.recordsSections.flatMap((section) => section.items.map((item) => item.id)),
    ...index.planSections.flatMap((section) => planSteps(section).map((step) => step.id)),
    ...index.sectionExhibits.map((item) => item.id),
    ...index.questions.map((item) => item.id),
    ...index.decisions.map((item) => item.id),
    ...index.decisions.flatMap((item) =>
      item.options.flatMap((option) => option.adds.map((addition) => addition.id)),
    ),
    ...index.optionExhibits.map((item) => item.id),
  ];
}

export function sectionEntity(section: BriefSection): BriefEntity {
  return {
    id: section.id,
    type: "section",
    label: section.title,
    detail: section.purpose,
    section,
  };
}

export function recordEntity(section: RecordsSection, record: BriefRecord): BriefEntity {
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

function findingEntity(section: FindingsSection, finding: Finding): BriefEntity {
  return {
    id: finding.id,
    type: "finding",
    label: finding.statement,
    ...(finding.whyItMatters ? { detail: finding.whyItMatters } : {}),
    finding,
    section,
  };
}

function planStepEntity(section: PlanSection, step: PlanStep, phase?: PlanPhase): BriefEntity {
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

export function exhibitEntity(exhibit: BriefExhibit, owner: ExhibitOwner): BriefEntity {
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

function questionEntity(item: Question): BriefEntity {
  return {
    id: item.id,
    type: "question",
    label: item.question,
    ...(item.impact ? { detail: item.impact } : {}),
    question: item,
  };
}

export function decisionEntity(item: Decision): BriefEntity {
  return {
    id: item.id,
    type: "decision",
    label: item.question,
    ...(item.rationale ? { detail: item.rationale } : {}),
    decision: item,
  };
}

export function recordLabel(record: BriefRecord): string {
  return record.subject ?? record.id;
}

export function fieldValueText(field: BriefField, value: string | string[]): string {
  if (field.kind === "text") return Array.isArray(value) ? value.join(", ") : value;
  const optionIds = Array.isArray(value) ? value : [value];
  return optionIds
    .map((optionId) => field.options.find((option) => option.id === optionId)?.label ?? optionId)
    .join(", ");
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
