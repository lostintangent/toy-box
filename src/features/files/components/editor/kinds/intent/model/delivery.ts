import { addDuplicateIssues, type RefinementContext } from "./issues";
import {
  decisionEntity,
  effectiveRelationsFrom,
  exhibitEntity,
  intentEntitiesFrom,
  recordEntity,
  selectedAdditionsFrom,
  type EffectiveRelation,
  type IntentEntity,
  type IntentWorkEntity,
} from "./projection";
import { buildIntentIndex, sectionPath, type IntentIndex } from "./read";
import { authoredRelations, dependencyPhases, relationCycle } from "./relations";
import { workItemEntries, workItems } from "./sequence";
import { reviewReadiness } from "./workflow";
import type {
  IntentDefinition,
  IntentDefinitionBase,
  IntentEntityId,
  IntentRecord,
  OptionAddition,
  RecordsSection,
} from "./schema";

/**
 * Delivery as a derived reading of the same graph: which settled obligations an
 * implementation must cover, which work entities are delivery units, and the rules
 * and ordering that keep build order distinct from the architecture it serves.
 */

export type DeliveryWorkUnit = {
  entity: IntentWorkEntity;
  coverage: Array<{
    relation: EffectiveRelation;
    source: IntentEntity;
  }>;
  dependencies: Array<{
    relation: EffectiveRelation;
    prerequisite: IntentWorkEntity;
  }>;
};

type DeliveryProjection = {
  present: boolean;
  obligations: IntentEntity[];
  workUnits: DeliveryWorkUnit[];
  phases: DeliveryWorkUnit[][];
  uncovered: IntentEntity[];
  cyclic: DeliveryWorkUnit[];
  complete: boolean;
};

type RecordLocation = {
  record: IntentRecord | OptionAddition;
  section: RecordsSection;
};

/** Delivery edges must join intent guidance to real, acyclic work units. */
export function addDeliveryIssues(
  definition: IntentDefinitionBase,
  index: IntentIndex,
  ctx: RefinementContext,
): void {
  const relations = authoredRelations(definition, index);
  const records = recordLocations(index);
  const workItemIds = new Set(
    index.sequences.flatMap((section) => workItems(section).map((item) => item.id)),
  );
  const implementationWorkIds = new Set(
    relations
      .filter(({ relation }) => relation.kind === "implemented-by")
      .map(({ relation }) => relation.to),
  );
  addDuplicateIssues(
    relations
      .filter(({ relation }) => relation.kind === "implemented-by")
      .map(({ relation }) => `${relation.from} -> ${relation.to}`),
    ctx,
    ["relations"],
    "Implementation coverage",
  );
  for (const section of index.sequences) {
    workItemEntries(section).forEach(({ item, path }) => {
      if (implementationWorkIds.has(item.id)) return;
      ctx.addIssue({
        code: "custom",
        message: `Work item "${item.id}" must be an implementation work unit.`,
        path: [...sectionPath(section), ...path],
      });
    });
  }

  for (const authored of relations) {
    const { relation, path } = authored;
    if (relation.kind === "implemented-by") {
      if (!isPotentialImplementationSource(relation.from, index, records)) {
        ctx.addIssue({
          code: "custom",
          message: `Relation "${relation.id}" must start from implementation guidance, a changed entity, or a decision.`,
          path: [...path, "from"],
        });
      }
      if (!workItemIds.has(relation.to)) {
        ctx.addIssue({
          code: "custom",
          message: `Relation "${relation.id}" must target an item in the delivery sequence.`,
          path: [...path, "to"],
        });
      }
      continue;
    }

    if (relation.kind !== "depends-on") continue;
    const fromWork = workItemIds.has(relation.from);
    const toWork = workItemIds.has(relation.to);
    if (!fromWork && !toWork) continue;
    if (!fromWork || !toWork) {
      ctx.addIssue({
        code: "custom",
        message: `Implementation dependency "${relation.id}" must connect two work units.`,
        path,
      });
    }
    if (!authored.root) {
      ctx.addIssue({
        code: "custom",
        message: `Implementation dependency "${relation.id}" must be a root relation.`,
        path,
      });
    }
    if (!relation.label) {
      ctx.addIssue({
        code: "custom",
        message: `Implementation dependency "${relation.id}" requires a reader-facing reason.`,
        path: [...path, "label"],
      });
    }
  }

  const dependencies = relations.filter(
    ({ relation, root }) =>
      root &&
      relation.kind === "depends-on" &&
      workItemIds.has(relation.from) &&
      workItemIds.has(relation.to),
  );
  addDuplicateIssues(
    dependencies.map(({ relation }) => `${relation.from} -> ${relation.to}`),
    ctx,
    ["relations"],
    "Implementation dependencies",
  );

  const cycle = relationCycle(
    workItemIds,
    dependencies.map(({ relation }) => relation),
  );
  if (cycle) {
    ctx.addIssue({
      code: "custom",
      message: `Implementation dependencies contain a cycle: ${cycle.join(" -> ")}.`,
      path: ["relations"],
    });
  }

  if (!cycle) {
    for (const section of index.sequences) {
      if (!("stages" in section)) continue;
      const ordered = dependencyPhases(
        workItems(section),
        (item) => item.id,
        dependencies.map(({ relation }) => relation),
      );
      const derivedStages = ordered.phases.map((phase) => phase.map((item) => item.id));
      const authoredStages = section.stages.map((stage) => stage.items.map((item) => item.id));
      if (JSON.stringify(derivedStages) === JSON.stringify(authoredStages)) continue;
      ctx.addIssue({
        code: "custom",
        message: `Named stages in "${section.title}" must match its dependency-derived delivery phases.`,
        path: [...sectionPath(section), "stages"],
      });
    }
  }
}

function recordLocations(index: IntentIndex): Map<string, RecordLocation> {
  return new Map<string, RecordLocation>([
    ...index.recordsSections.flatMap((section) =>
      section.items.map((record) => [record.id, { record, section }] as const),
    ),
    ...index.decisions.flatMap((item) =>
      item.options.flatMap((option) =>
        option.adds.flatMap((record) => {
          const section = index.recordsSectionsById.get(record.sectionId);
          return section ? ([[record.id, { record, section }]] as const) : [];
        }),
      ),
    ),
  ]);
}

function isPotentialImplementationSource(
  entityId: IntentEntityId,
  index: IntentIndex,
  records: ReadonlyMap<string, RecordLocation>,
): boolean {
  if (index.decisions.some((item) => item.id === entityId)) return true;
  const section = index.leaves.find((candidate) => candidate.id === entityId);
  if (section) return section.kind === "prose" || section.kind === "list";
  const exhibit = index.exhibits.find((item) => item.id === entityId);
  if (exhibit) return exhibit.change !== "existing";
  const location = records.get(entityId);
  return Boolean(location && location.record.change !== "existing");
}

/** Settled structured changes are the obligations an authored delivery sequence must cover. */
export function implementationObligations(definition: IntentDefinition): IntentEntity[] {
  return implementationObligationsFrom(buildIntentIndex(definition.sections));
}

function implementationObligationsFrom(index: IntentIndex): IntentEntity[] {
  const obligations = index.leaves.flatMap((section): IntentEntity[] => {
    if (section.kind === "exhibits") {
      return section.items
        .filter((item) => item.change !== "existing")
        .map((item) => exhibitEntity(section, item));
    }
    if (section.kind !== "records") return [];
    return [
      ...section.items
        .filter((record) => record.change !== "existing")
        .map((record) => recordEntity(section, record)),
      ...selectedAdditionsFrom(index, section.id)
        .filter((selected) => selected.status === "decided")
        .map((selected) => recordEntity(section, selected.item)),
    ];
  });
  const decisions: IntentEntity[] = index.decisions
    .filter((item) => item.status === "decided")
    .map((item) => decisionEntity(item));
  return [...obligations, ...decisions];
}

/**
 * Project deterministic delivery phases from settled obligation coverage and
 * work-unit dependencies. Authored work order breaks ties within a phase.
 */
export function deliveryProjection(definition: IntentDefinition): DeliveryProjection {
  const index = buildIntentIndex(definition.sections);
  const obligations = implementationObligationsFrom(index);
  const obligationIds = new Set(obligations.map((entity) => entity.id));
  const guidanceIds = new Set(
    index.leaves
      .filter((section) => section.kind === "prose" || section.kind === "list")
      .map((section) => section.id),
  );
  const entities = intentEntitiesFrom(index);
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
  const settledRelations = effectiveRelationsFrom(definition, index).filter(
    (effective) => effective.status !== "provisional",
  );
  const coverageRelations = settledRelations.filter(
    ({ relation }) =>
      relation.kind === "implemented-by" &&
      (obligationIds.has(relation.from) || guidanceIds.has(relation.from)),
  );
  const authoredWorkIds = new Set(
    authoredRelations(definition, index)
      .map(({ relation }) => relation)
      .filter((relation) => relation.kind === "implemented-by")
      .map((relation) => relation.to),
  );
  const selectedWorkIds = new Set(coverageRelations.map(({ relation }) => relation.to));
  const authoredDependencies = settledRelations.filter(
    ({ relation }) =>
      relation.kind === "depends-on" &&
      authoredWorkIds.has(relation.from) &&
      authoredWorkIds.has(relation.to),
  );
  let addedPrerequisite = true;
  while (addedPrerequisite) {
    addedPrerequisite = false;
    for (const { relation } of authoredDependencies) {
      if (selectedWorkIds.has(relation.from) && !selectedWorkIds.has(relation.to)) {
        selectedWorkIds.add(relation.to);
        addedPrerequisite = true;
      }
    }
  }
  const workEntities = entities.filter(
    (entity): entity is IntentWorkEntity =>
      entity.type === "work" && selectedWorkIds.has(entity.id),
  );
  const dependencies = authoredDependencies.filter(
    ({ relation }) => selectedWorkIds.has(relation.from) && selectedWorkIds.has(relation.to),
  );
  const workUnits = workEntities.map(
    (entity): DeliveryWorkUnit => ({
      entity,
      coverage: coverageRelations.flatMap((effective) => {
        if (effective.relation.to !== entity.id) return [];
        const source = entitiesById.get(effective.relation.from);
        return source ? [{ relation: effective, source }] : [];
      }),
      dependencies: dependencies.flatMap((effective) => {
        if (effective.relation.from !== entity.id) return [];
        const prerequisite = entitiesById.get(effective.relation.to);
        return prerequisite?.type === "work" ? [{ relation: effective, prerequisite }] : [];
      }),
    }),
  );
  const ordered = dependencyPhases(
    workUnits,
    (unit) => unit.entity.id,
    dependencies.map(({ relation }) => relation),
  );

  const coveredIds = new Set(coverageRelations.map(({ relation }) => relation.from));
  const uncovered = obligations.filter((entity) => !coveredIds.has(entity.id));
  return {
    present: index.sequences.length > 0,
    obligations,
    workUnits,
    phases: ordered.phases,
    uncovered,
    cyclic: ordered.cyclic,
    complete: workUnits.length > 0 && uncovered.length === 0 && ordered.cyclic.length === 0,
  };
}

/**
 * Settled intent can start directly. Authoring a sequence opts into complete
 * obligation coverage and a usable dependency order.
 */
export function executionReadiness(definition: IntentDefinition) {
  const review = reviewReadiness(definition);
  const delivery = deliveryProjection(definition);
  return {
    review,
    delivery,
    ready: review.approvable && (!delivery.present || delivery.complete),
  };
}
