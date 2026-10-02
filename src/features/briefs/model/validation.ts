import {
  addDuplicateIssues,
  addEntityReferenceIssue,
  sectionPath,
  type RefinementContext,
} from "./issues";
import { planStepLocations } from "./plan/steps";
import { addPlanIssues } from "./plan/validation";
import { briefEntityIds, recordLabel } from "./query/entities";
import { buildBriefIndex, isDescriptionSection, type BriefIndex } from "./query/structure";
import type {
  Change,
  Decision,
  DomainTreeEntry,
  ExhibitsSection,
  FindingsSection,
  FileTreeEntry,
  BriefDocument,
  BriefExhibit,
  BriefField,
  BriefRecord,
  OptionRelationship,
  PlanSection,
  PlanStep,
  Question,
  RecordsSection,
  SourcePolicy,
} from "./schema";
import { addFlowIssues } from "./spec/flow";

/**
 * The semantic rules a structurally valid brief must still satisfy: globally
 * unique identity, resolvable references, honest sources, records and fields,
 * and the flow and plan rules owned by their own modules.
 */

export function validateDocument(document: BriefDocument, ctx: RefinementContext): void {
  const index = buildBriefIndex(document.sections);
  addTabIssues(document, ctx);
  addDuplicateIssues(briefEntityIds(index), ctx, ["sections"], "Brief entity IDs");

  const relationshipIds = index.decisions.flatMap((item) =>
    item.options.flatMap((option) =>
      (option.relationships ?? []).map((relationship) => relationship.id),
    ),
  );
  addDuplicateIssues(relationshipIds, ctx, ["sections"], "Decision option relationship IDs");

  const questionIds = new Set(index.questions.map((item) => item.id));
  const findingIds = new Set(index.findings.map((item) => item.id));
  const optionRecordIds = index.decisions.flatMap((item) =>
    item.options.flatMap((option) => option.adds.map((addition) => addition.id)),
  );
  const optionExhibitIds = index.optionExhibits.map((exhibit) => exhibit.id);
  const relationshipEntities = new Set(specRelationshipEntityIds(index));
  const flowIds = new Set(
    [...index.sectionExhibits, ...index.optionExhibits]
      .filter((exhibit) => exhibit.kind === "flow")
      .map((exhibit) => exhibit.id),
  );
  const sharedFlowEntityIds = new Set(
    [...relationshipEntities, ...optionRecordIds, ...optionExhibitIds].filter(
      (id) => !flowIds.has(id),
    ),
  );

  const decisionReferences: DecisionReferences = {
    findingIds,
    questionIds,
    relationshipEntities,
    recordsSectionsById: index.recordsSectionsById,
  };
  for (const section of index.specSections) {
    const path = sectionPath(section.id);
    if (section.kind === "records") {
      addRecordsIssues(section, findingIds, ctx);
    } else if (section.kind === "exhibits") {
      addExhibitIssues(section, sharedFlowEntityIds, findingIds, ctx);
    } else if (section.kind === "list") {
      addDuplicateIssues(section.items, ctx, path, `Items in "${section.title}"`);
    } else if (section.kind === "questions") {
      for (const item of section.items) {
        addQuestionIssues(item, relationshipEntities, ctx, [...path, "items", item.id]);
      }
    } else if (section.kind === "decisions") {
      for (const item of section.items) {
        addDecisionIssues(item, decisionReferences, ctx, [...path, "items", item.id]);
      }
    }
  }
  for (const section of index.findingSections) {
    addFindingIssues(section, sharedFlowEntityIds, ctx);
  }
  for (const section of index.planSections) addPlanFieldIssues(section, ctx);
  addPlanIssues(index, ctx);
}

function addQuestionIssues(
  question: Question,
  relationshipEntities: ReadonlySet<string>,
  ctx: RefinementContext,
  path: PropertyKey[],
): void {
  addDuplicateIssues(
    question.affects,
    ctx,
    [...path, "affects"],
    `Affected entities for question "${question.id}"`,
  );
  question.affects.forEach((reference, referenceIndex) => {
    addEntityReferenceIssue(reference, relationshipEntities, ctx, [
      ...path,
      "affects",
      referenceIndex,
    ]);
  });
}

type DecisionReferences = {
  findingIds: ReadonlySet<string>;
  questionIds: ReadonlySet<string>;
  relationshipEntities: ReadonlySet<string>;
  recordsSectionsById: ReadonlyMap<string, RecordsSection>;
};

function addDecisionIssues(
  decision: Decision,
  references: DecisionReferences,
  ctx: RefinementContext,
  path: PropertyKey[],
): void {
  const { findingIds, questionIds, relationshipEntities, recordsSectionsById } = references;
  addBasedOnIssues(decision, findingIds, ctx, path, "Decision");
  addDuplicateIssues(
    decision.affects,
    ctx,
    [...path, "affects"],
    `Affected entities for decision "${decision.id}"`,
  );
  decision.dependsOn.forEach((questionId, dependencyIndex) => {
    if (!questionIds.has(questionId)) {
      ctx.addIssue({
        code: "custom",
        message: `Decision "${decision.id}" depends on unknown question "${questionId}".`,
        path: [...path, "dependsOn", dependencyIndex],
      });
    }
  });
  decision.affects.forEach((reference, referenceIndex) => {
    addEntityReferenceIssue(reference, relationshipEntities, ctx, [
      ...path,
      "affects",
      referenceIndex,
    ]);
  });

  decision.options.forEach((option, optionIndex) => {
    const optionPath = [...path, "options", optionIndex];
    option.adds.forEach((addition, additionIndex) => {
      const additionPath = [...optionPath, "adds", additionIndex];
      const target = recordsSectionsById.get(addition.sectionId);
      if (!target) {
        ctx.addIssue({
          code: "custom",
          message: `Option addition references unknown records section "${addition.sectionId}".`,
          path: [...additionPath, "sectionId"],
        });
        return;
      }
      addRecordIssues(addition, target, findingIds, ctx, additionPath, false);
    });
    const optionEntities = new Set([
      ...relationshipEntities,
      ...option.adds.map((addition) => addition.id),
      ...(option.exhibit ? [option.exhibit.id] : []),
    ]);
    if (option.exhibit) {
      const exhibitPath = [...optionPath, "exhibit"];
      if (option.exhibit.change === "existing") {
        ctx.addIssue({
          code: "custom",
          message: "Decision options may define only changed or preserved exhibits.",
          path: [...exhibitPath, "change"],
        });
      }
      addBasedOnIssues(option.exhibit, findingIds, ctx, exhibitPath, "Exhibit");
      addExhibitStructureIssues(option.exhibit, optionEntities, ctx, exhibitPath);
    }
    (option.relationships ?? []).forEach((relationship, relationshipIndex) => {
      addRelationshipIssues(relationship, optionEntities, ctx, [
        ...optionPath,
        "relationships",
        relationshipIndex,
      ]);
    });
  });
}

function addTabIssues(document: BriefDocument, ctx: RefinementContext): void {
  if (!document.tabs) return;
  addDuplicateIssues(
    document.tabs.map((tab) => tab.title),
    ctx,
    ["tabs"],
    "Tab titles",
  );

  const sectionIds = new Set(document.sections.map((section) => section.id));
  const tabSectionIds = document.tabs.flatMap((tab) => tab.sections);
  addDuplicateIssues(tabSectionIds, ctx, ["tabs"], "Sections across tabs");

  document.tabs.forEach((tab, tabIndex) => {
    tab.sections.forEach((sectionId, sectionIndex) => {
      if (sectionIds.has(sectionId)) return;
      ctx.addIssue({
        code: "custom",
        message: `Tab "${tab.title}" references unknown top-level section "${sectionId}".`,
        path: ["tabs", tabIndex, "sections", sectionIndex],
      });
    });
  });

  const assigned = new Set(tabSectionIds);
  const missing = document.sections.filter((section) => !assigned.has(section.id));
  if (missing.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: `Tabs must include every top-level section; missing ${missing
        .map((section) => `"${section.id}"`)
        .join(", ")}.`,
      path: ["tabs"],
    });
  }
}

function specRelationshipEntityIds(index: BriefIndex): string[] {
  return [
    ...index.specSections.filter(isDescriptionSection).map((section) => section.id),
    ...index.recordsSections.flatMap((section) => section.items.map((item) => item.id)),
    ...index.sectionExhibits.map((item) => item.id),
    ...index.questions.map((item) => item.id),
    ...index.decisions.map((item) => item.id),
  ];
}

function addRelationshipIssues(
  relationship: OptionRelationship,
  knownEntities: ReadonlySet<string>,
  ctx: RefinementContext,
  path: PropertyKey[],
): void {
  addEntityReferenceIssue(relationship.from, knownEntities, ctx, [...path, "from"]);
  addEntityReferenceIssue(relationship.to, knownEntities, ctx, [...path, "to"]);
  if (relationship.from === relationship.to) {
    ctx.addIssue({
      code: "custom",
      message: `Relationship "${relationship.id}" cannot connect an entity to itself.`,
      path,
    });
  }
}

function addRecordsIssues(
  section: RecordsSection,
  findingIds: ReadonlySet<string>,
  ctx: RefinementContext,
): void {
  const path = sectionPath(section.id);
  if (!section.subject && section.fields.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: `Records section "${section.title}" must declare a subject or at least one field.`,
      path,
    });
  }
  addFieldDefinitionIssues(section, section.subject ? [section.subject] : [], ctx, path);

  section.items.forEach((item, itemIndex) => {
    addRecordIssues(item, section, findingIds, ctx, [...path, "items", itemIndex], true);
  });
}

function addPlanFieldIssues(section: PlanSection, ctx: RefinementContext): void {
  const path = sectionPath(section.id);
  addFieldDefinitionIssues(section, ["Step", "Done when", "Status"], ctx, path);
  planStepLocations(section).forEach(({ step, path: stepPath }) => {
    addFieldValuesIssues(step, section, ctx, [...path, ...stepPath]);
  });
}

function addFieldDefinitionIssues(
  section: Pick<RecordsSection | PlanSection, "title" | "fields">,
  implicitLabels: readonly string[],
  ctx: RefinementContext,
  path: PropertyKey[],
): void {
  addDuplicateIssues(
    section.fields.map((field) => field.id),
    ctx,
    [...path, "fields"],
    `Field ids in "${section.title}"`,
  );
  addDuplicateIssues(
    [...implicitLabels, ...section.fields.map((field) => field.label)],
    ctx,
    [...path, "fields"],
    `Column labels in "${section.title}"`,
  );

  section.fields.forEach((field, fieldIndex) => {
    if (field.kind !== "choice") return;
    addDuplicateIssues(
      field.options.map((option) => option.id),
      ctx,
      [...path, "fields", fieldIndex, "options"],
      `Choice ids for "${field.label}"`,
    );
    addDuplicateIssues(
      field.options.map((option) => option.label),
      ctx,
      [...path, "fields", fieldIndex, "options"],
      `Choice labels for "${field.label}"`,
    );
  });
}

function addExhibitIssues(
  section: ExhibitsSection,
  sharedFlowEntityIds: ReadonlySet<string>,
  findingIds: ReadonlySet<string>,
  ctx: RefinementContext,
): void {
  const path = sectionPath(section.id);
  section.items.forEach((item, itemIndex) => {
    const itemPath = [...path, "items", itemIndex];
    addSourceIssues(item, section, ctx, itemPath, "Exhibit");
    addBasedOnIssues(item, findingIds, ctx, itemPath, "Exhibit");
    addExhibitStructureIssues(item, sharedFlowEntityIds, ctx, itemPath);
  });
}

function addFindingIssues(
  section: FindingsSection,
  sharedFlowEntityIds: ReadonlySet<string>,
  ctx: RefinementContext,
): void {
  const path = sectionPath(section.id);
  for (const [itemIndex, item] of section.items.entries()) {
    const itemPath = [...path, "items", itemIndex];
    const sources = item.sources ?? [];
    addDuplicateIssues(sources, ctx, [...itemPath, "sources"], `Sources for finding "${item.id}"`);
    if (section.sourcePolicy !== "optional" && sources.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `Findings in "${section.title}" require at least one source.`,
        path: [...itemPath, "sources"],
      });
    }
    if (section.sourcePolicy === "code") {
      sources.forEach((reference, sourceIndex) => {
        if (isWorkspaceCodeLocation(reference)) return;
        ctx.addIssue({
          code: "custom",
          message: `Sources in "${section.title}" must be workspace-relative code locations with an optional #Symbol.`,
          path: [...itemPath, "sources", sourceIndex],
        });
      });
    }
    if (!item.exhibit) continue;
    if (item.exhibit.change !== "existing") {
      ctx.addIssue({
        code: "custom",
        message: `An exhibit attached to finding "${item.id}" must describe existing evidence.`,
        path: [...itemPath, "exhibit", "change"],
      });
    }
    if (item.exhibit.basedOn) {
      ctx.addIssue({
        code: "custom",
        message: `An exhibit attached to finding "${item.id}" cannot itself be based on findings.`,
        path: [...itemPath, "exhibit", "basedOn"],
      });
    }
    if (
      section.sourcePolicy === "code" &&
      item.exhibit.source &&
      !isWorkspaceCodeLocation(item.exhibit.source)
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Exhibit source in "${section.title}" must be a workspace-relative code location with an optional #Symbol.`,
        path: [...itemPath, "exhibit", "source"],
      });
    }
    addExhibitStructureIssues(item.exhibit, sharedFlowEntityIds, ctx, [...itemPath, "exhibit"]);
  }
}

function addExhibitStructureIssues(
  item: BriefExhibit,
  sharedFlowEntityIds: ReadonlySet<string>,
  ctx: RefinementContext,
  itemPath: PropertyKey[],
): void {
  if (item.kind === "flow") {
    addFlowIssues(item, sharedFlowEntityIds, ctx, itemPath);
  } else if (item.kind === "tree") {
    if (item.type === "files") {
      addFileTreeIssues(item.roots, ctx, [...itemPath, "roots"], item.title);
    } else {
      addDomainTreeIssues(item.roots, ctx, [...itemPath, "roots"], item.title);
    }
  }
}

function addDomainTreeIssues(
  entries: readonly DomainTreeEntry[],
  ctx: RefinementContext,
  path: PropertyKey[],
  exhibitTitle: string,
): void {
  addDuplicateIssues(
    entries.map((entry) => entry.name),
    ctx,
    path,
    `Sibling names in "${exhibitTitle}"`,
  );
  entries.forEach((entry, entryIndex) => {
    if (entry.children) {
      addDomainTreeIssues(entry.children, ctx, [...path, entryIndex, "children"], exhibitTitle);
    }
  });
}

function addFileTreeIssues(
  entries: readonly FileTreeEntry[],
  ctx: RefinementContext,
  path: PropertyKey[],
  exhibitTitle: string,
): void {
  addDuplicateIssues(
    entries.map((entry) => entry.name),
    ctx,
    path,
    `Sibling names in "${exhibitTitle}"`,
  );
  entries.forEach((entry, entryIndex) => {
    if (entry.kind === "folder") {
      addFileTreeIssues(entry.children, ctx, [...path, entryIndex, "children"], exhibitTitle);
    }
  });
}

function addRecordIssues(
  item: BriefRecord,
  section: RecordsSection,
  findingIds: ReadonlySet<string>,
  ctx: RefinementContext,
  path: PropertyKey[],
  allowExisting: boolean,
): void {
  if (section.subject && !item.subject) {
    ctx.addIssue({
      code: "custom",
      message: `Record "${item.id}" must supply the "${section.subject}" subject.`,
      path: [...path, "subject"],
    });
  } else if (!section.subject && item.subject) {
    ctx.addIssue({
      code: "custom",
      message: `Record "${item.id}" supplies a subject that "${section.title}" does not declare.`,
      path: [...path, "subject"],
    });
  }

  if (!allowExisting && item.change === "existing") {
    ctx.addIssue({
      code: "custom",
      message: "Decision options may add only changed or preserved records.",
      path: [...path, "change"],
    });
  }

  addSourceIssues(item, section, ctx, path, "Record");
  addBasedOnIssues(item, findingIds, ctx, path, "Record");

  addFieldValuesIssues(item, section, ctx, path);
}

function addBasedOnIssues(
  item: { id: string; basedOn?: readonly string[] },
  findingIds: ReadonlySet<string>,
  ctx: RefinementContext,
  path: PropertyKey[],
  itemKind: "Record" | "Exhibit" | "Decision",
): void {
  if (!item.basedOn) return;
  addDuplicateIssues(
    item.basedOn,
    ctx,
    [...path, "basedOn"],
    `Findings for ${itemKind.toLowerCase()} "${item.id}"`,
  );
  item.basedOn.forEach((findingId, findingIndex) => {
    if (findingIds.has(findingId)) return;
    ctx.addIssue({
      code: "custom",
      message: `${itemKind} "${item.id}" is based on unknown finding "${findingId}".`,
      path: [...path, "basedOn", findingIndex],
    });
  });
}

function addSourceIssues(
  item: { change: Change; source?: string },
  section: { title: string; sourcePolicy: SourcePolicy },
  ctx: RefinementContext,
  path: PropertyKey[],
  itemKind: "Record" | "Exhibit",
): void {
  const currentState = item.change !== "new";
  if (section.sourcePolicy !== "optional" && currentState && !item.source) {
    ctx.addIssue({
      code: "custom",
      message: `${item.change} ${itemKind.toLowerCase()}s in "${section.title}" require a source.`,
      path: [...path, "source"],
    });
  }
  if (section.sourcePolicy === "code" && item.source && !isWorkspaceCodeLocation(item.source)) {
    ctx.addIssue({
      code: "custom",
      message: `Source in "${section.title}" must be a workspace-relative code location with an optional #Symbol.`,
      path: [...path, "source"],
    });
  }
}

type FieldValueItem = BriefRecord | PlanStep;

function fieldValueItemLabel(item: FieldValueItem): string {
  return "title" in item ? item.title : recordLabel(item);
}

function addFieldValuesIssues(
  item: FieldValueItem,
  section: Pick<RecordsSection | PlanSection, "fields">,
  ctx: RefinementContext,
  path: PropertyKey[],
): void {
  const fieldIds = new Set(section.fields.map((field) => field.id));
  for (const field of section.fields) {
    if (!Object.hasOwn(item.values, field.id)) {
      ctx.addIssue({
        code: "custom",
        message: `Item "${fieldValueItemLabel(item)}" is missing field "${field.label}".`,
        path: [...path, "values", field.id],
      });
      continue;
    }
    addFieldValueIssues(item, field, ctx, path);
  }
  for (const key of Object.keys(item.values)) {
    if (!fieldIds.has(key)) {
      ctx.addIssue({
        code: "custom",
        message: `Item "${fieldValueItemLabel(item)}" uses undeclared field "${key}".`,
        path: [...path, "values", key],
      });
    }
  }
}

function addFieldValueIssues(
  item: FieldValueItem,
  field: BriefField,
  ctx: RefinementContext,
  path: PropertyKey[],
): void {
  const fieldValue = item.values[field.id]!;
  const valuePath = [...path, "values", field.id];

  if (field.kind === "text") {
    if (Array.isArray(fieldValue)) {
      ctx.addIssue({
        code: "custom",
        message: `Text field "${field.label}" requires one string value.`,
        path: valuePath,
      });
    }
    return;
  }

  const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
  if (field.cardinality === "one" && Array.isArray(fieldValue)) {
    ctx.addIssue({
      code: "custom",
      message: `Choice field "${field.label}" requires exactly one option.`,
      path: valuePath,
    });
  }
  if (field.cardinality === "many" && !Array.isArray(fieldValue)) {
    ctx.addIssue({
      code: "custom",
      message: `Choice field "${field.label}" requires an option array.`,
      path: valuePath,
    });
  }

  const optionIds = new Set(field.options.map((option) => option.id));
  const seen = new Set<string>();
  values.forEach((optionId, optionIndex) => {
    if (!optionIds.has(optionId)) {
      ctx.addIssue({
        code: "custom",
        message: `Item "${fieldValueItemLabel(item)}" uses unknown "${field.label}" option "${optionId}".`,
        path: [...valuePath, ...(Array.isArray(fieldValue) ? [optionIndex] : [])],
      });
    }
    if (seen.has(optionId)) {
      ctx.addIssue({
        code: "custom",
        message: `Item "${fieldValueItemLabel(item)}" repeats "${field.label}" option "${optionId}".`,
        path: [...valuePath, optionIndex],
      });
    }
    seen.add(optionId);
  });
}

function isWorkspaceCodeLocation(reference: string): boolean {
  if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.includes("\\")) return false;
  const marker = reference.indexOf("#");
  const path = marker === -1 ? reference : reference.slice(0, marker);
  const symbol = marker === -1 ? undefined : reference.slice(marker + 1);
  return (
    !path.startsWith("/") &&
    !path.startsWith("~/") &&
    !path.split("/").includes("..") &&
    (path.includes("/") || path.includes(".")) &&
    (symbol === undefined || symbol.trim().length > 0)
  );
}
