import { addDuplicateIssues, addEntityReferenceIssue, type RefinementContext } from "./issues";
import { addMapIssues } from "./maps";
import { addDeliveryIssues } from "./delivery";
import { recordLabel } from "./projection";
import {
  buildIntentIndex,
  decisionPathIn,
  questionPathIn,
  sectionPath,
  sectionPathForId,
  type IntentIndex,
} from "./read";
import { authoredRelations, relationshipMapCandidates } from "./relations";
import { workItemEntries, workItems } from "./sequence";
import type {
  Change,
  ExhibitsSection,
  IntentDefinitionBase,
  IntentField,
  IntentRecord,
  IntentRelation,
  OptionAddition,
  RecordsSection,
  SequenceSection,
  WorkItem,
} from "./schema";

/**
 * The semantic rules a structurally valid intent must still satisfy: globally
 * unique identity, resolvable references, honest records and fields, and the
 * map and delivery rules owned by their own modules.
 */

export function validateDefinition(definition: IntentDefinitionBase, ctx: RefinementContext): void {
  const index = buildIntentIndex(definition.sections);
  if (definition.savedVersion) {
    addDuplicateIssues(
      definition.savedVersion.items.map((item) => item.key),
      ctx,
      ["savedVersion", "items"],
      "Saved version item keys",
    );
    const intentItems = definition.savedVersion.items.filter((item) => item.kind === "intent");
    if (intentItems.length !== 1 || intentItems[0]?.key !== "intent:root") {
      ctx.addIssue({
        code: "custom",
        message: "A saved version must contain exactly one intent:root item.",
        path: ["savedVersion", "items"],
      });
    }
    definition.savedVersion.items.forEach((item, index) => {
      const prefix = `${item.kind}:`;
      if (item.key.startsWith(prefix) && item.key.length > prefix.length) return;
      ctx.addIssue({
        code: "custom",
        message: `Saved version item "${item.key}" must use its "${prefix}" prefix.`,
        path: ["savedVersion", "items", index, "key"],
      });
    });
  }
  const sharedIds = sharedEntityIds(index);
  const optionRecordIds = index.decisions.flatMap((item) =>
    item.options.flatMap((option) => option.adds.map((addition) => addition.id)),
  );
  addDuplicateIssues([...sharedIds, ...optionRecordIds], ctx, ["sections"], "Graph entity IDs");

  const relationIds = [
    ...definition.relations.map((relation) => relation.id),
    ...index.decisions.flatMap((item) =>
      item.options.flatMap((option) => option.relations.map((relation) => relation.id)),
    ),
  ];
  addDuplicateIssues(relationIds, ctx, ["relations"], "Relation ids");

  for (const section of index.leaves) {
    if (section.kind === "records") {
      addRecordsIssues(section, ctx);
    } else if (section.kind === "sequence") {
      addSequenceIssues(section, ctx);
    } else if (section.kind === "exhibits") {
      addExhibitIssues(section, ctx);
    } else if (section.kind === "list") {
      addDuplicateIssues(section.items, ctx, sectionPath(section), `Items in "${section.title}"`);
    }
  }
  if (index.sequences.length > 1) {
    ctx.addIssue({
      code: "custom",
      message: "An intent can contain only one delivery sequence.",
      path: ["sections"],
    });
  }

  const questionIds = new Set(index.questions.map((item) => item.id));
  const sharedEntities = new Set(sharedIds);
  const allEntities = new Set([...sharedIds, ...optionRecordIds]);
  const workIds = new Set(
    index.sequences.flatMap((section) => workItems(section).map((item) => item.id)),
  );
  const readableRelations = relationshipMapCandidates(
    authoredRelations(definition, index).map(({ relation }) => relation),
    workIds,
  );

  addMapIssues(index.maps, allEntities, readableRelations, ctx);

  definition.relations.forEach((relation, relationIndex) => {
    addRelationIssues(relation, sharedEntities, ctx, ["relations", relationIndex]);
  });

  index.questions.forEach((item) => {
    item.affects.forEach((reference, referenceIndex) => {
      addEntityReferenceIssue(reference, sharedEntities, ctx, [
        ...questionPathIn(index, item),
        "affects",
        referenceIndex,
      ]);
    });
  });

  for (const item of index.decisions) {
    const decisionPath = decisionPathIn(index, item);
    item.dependsOn.forEach((questionId, dependencyIndex) => {
      if (!questionIds.has(questionId)) {
        ctx.addIssue({
          code: "custom",
          message: `Decision "${item.id}" depends on unknown question "${questionId}".`,
          path: [...decisionPath, "dependsOn", dependencyIndex],
        });
      }
    });
    item.affects.forEach((reference, referenceIndex) => {
      addEntityReferenceIssue(reference, sharedEntities, ctx, [
        ...decisionPath,
        "affects",
        referenceIndex,
      ]);
    });

    item.options.forEach((option, optionIndex) => {
      option.adds.forEach((addition, additionIndex) => {
        const path = [...decisionPath, "options", optionIndex, "adds", additionIndex];
        const target = index.recordsSectionsById.get(addition.sectionId);
        if (!target) {
          ctx.addIssue({
            code: "custom",
            message: `Option addition references unknown records section "${addition.sectionId}".`,
            path: [...path, "sectionId"],
          });
          return;
        }
        addRecordIssues(addition, target, ctx, path, false);
      });
      const optionEntities = new Set([
        ...sharedEntities,
        ...option.adds.map((addition) => addition.id),
      ]);
      option.relations.forEach((relation, relationIndex) => {
        addRelationIssues(relation, optionEntities, ctx, [
          ...decisionPath,
          "options",
          optionIndex,
          "relations",
          relationIndex,
        ]);
      });
    });
  }

  addDeliveryIssues(definition, index, ctx);
}

function sharedEntityIds(index: IntentIndex): string[] {
  return [
    ...index.sections.map((section) => section.id),
    ...index.recordsSections.flatMap((section) => section.items.map((item) => item.id)),
    ...index.sequences.flatMap((section) => workItems(section).map((item) => item.id)),
    ...index.exhibits.map((item) => item.id),
    ...index.questions.map((item) => item.id),
    ...index.decisions.map((item) => item.id),
  ];
}

function addRelationIssues(
  relation: IntentRelation,
  knownEntities: ReadonlySet<string>,
  ctx: RefinementContext,
  path: PropertyKey[],
): void {
  addEntityReferenceIssue(relation.from, knownEntities, ctx, [...path, "from"]);
  addEntityReferenceIssue(relation.to, knownEntities, ctx, [...path, "to"]);
  if (relation.from === relation.to) {
    ctx.addIssue({
      code: "custom",
      message: `Relation "${relation.id}" cannot connect an entity to itself.`,
      path,
    });
  }
}

function addRecordsIssues(section: RecordsSection, ctx: RefinementContext): void {
  const path = sectionPathForId(section.id);
  if (!section.subject && section.fields.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: `Records section "${section.title}" must declare a subject or at least one field.`,
      path,
    });
  }
  addFieldDefinitionIssues(section, section.subject ? [section.subject] : [], ctx, path);

  section.items.forEach((item, itemIndex) => {
    addRecordIssues(item, section, ctx, [...path, "items", itemIndex], true);
  });
}

function addSequenceIssues(section: SequenceSection, ctx: RefinementContext): void {
  const path = sectionPathForId(section.id);
  addFieldDefinitionIssues(section, [], ctx, path);
  if ("stages" in section) {
    addDuplicateIssues(
      section.stages.map((stage) => stage.id),
      ctx,
      [...path, "stages"],
      `Stages in "${section.title}"`,
    );
  }
  workItemEntries(section).forEach(({ item, path: itemPath }) => {
    addFieldValuesIssues(item, section, ctx, [...path, ...itemPath]);
  });
}

function addFieldDefinitionIssues(
  section: Pick<RecordsSection | SequenceSection, "title" | "fields">,
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

function addExhibitIssues(section: ExhibitsSection, ctx: RefinementContext): void {
  const path = sectionPathForId(section.id);
  section.items.forEach((item, itemIndex) => {
    const itemPath = [...path, "items", itemIndex];
    addProvenanceIssues(item, section, ctx, itemPath, "Exhibit");
    if (item.kind === "procedure") {
      addDuplicateIssues(
        item.steps.map((step) => step.id),
        ctx,
        [...itemPath, "steps"],
        `Step ids in "${item.title}"`,
      );
    }
  });
}

function addRecordIssues(
  item: IntentRecord | OptionAddition,
  section: RecordsSection,
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

  addProvenanceIssues(item, section, ctx, path, "Record");

  addFieldValuesIssues(item, section, ctx, path);
}

function addProvenanceIssues(
  item: { change: Change; provenance?: string },
  section: { title: string; provenance: "code" | "reference" | "optional" },
  ctx: RefinementContext,
  path: PropertyKey[],
  itemKind: "Record" | "Exhibit",
): void {
  const currentState = item.change !== "new";
  if (section.provenance !== "optional" && currentState && !item.provenance) {
    ctx.addIssue({
      code: "custom",
      message: `${item.change} ${itemKind.toLowerCase()}s in "${section.title}" require provenance.`,
      path: [...path, "provenance"],
    });
  }
  if (
    section.provenance === "code" &&
    item.provenance &&
    !isWorkspaceCodeLocation(item.provenance)
  ) {
    ctx.addIssue({
      code: "custom",
      message: `Provenance in "${section.title}" must be a workspace-relative code location with an optional #Symbol.`,
      path: [...path, "provenance"],
    });
  }
}

type FieldValueItem = IntentRecord | OptionAddition | WorkItem;

function fieldValueItemLabel(item: FieldValueItem): string {
  return "title" in item ? item.title : recordLabel(item);
}

function addFieldValuesIssues(
  item: FieldValueItem,
  section: Pick<RecordsSection | SequenceSection, "fields">,
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
  field: IntentField,
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
  const marker = reference.indexOf("#");
  const path = marker === -1 ? reference : reference.slice(0, marker);
  const symbol = marker === -1 ? undefined : reference.slice(marker + 1);
  return (
    !path.startsWith("/") &&
    !path.split("/").includes("..") &&
    (path.includes("/") || path.includes(".")) &&
    (symbol === undefined || symbol.trim().length > 0)
  );
}
