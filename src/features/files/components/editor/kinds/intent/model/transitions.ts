import { buildIntentIndex } from "./read";
import { unresolvedDependencies } from "./workflow";
import type {
  Decision,
  IntentDefinition,
  IntentExhibitUpdate,
  IntentRecordUpdate,
  IntentRelation,
  IntentSection,
  LeafSection,
  RecordsView,
  WorkItemUpdate,
} from "./schema";
import { workItems } from "./sequence";

/**
 * Editor-owned immutable transitions over an `IntentDefinition`: disclosure,
 * decision and question lifecycle, editable content updates, and graph-safe
 * removal of proposed shared items.
 */

export function setIntentSectionCollapsed(
  definition: IntentDefinition,
  sectionId: string,
  collapsed: boolean,
): IntentDefinition {
  let changed = false;
  const sections = definition.sections.map((section) => {
    if (section.id !== sectionId || section.collapsed === collapsed) return section;
    changed = true;
    return { ...section, collapsed };
  });
  return changed ? { ...definition, sections } : definition;
}

export function setAllIntentSectionsCollapsed(
  definition: IntentDefinition,
  collapsed: boolean,
): IntentDefinition {
  let changed = false;
  const sections = definition.sections.map((section) => {
    if (section.collapsed === collapsed) return section;
    changed = true;
    return { ...section, collapsed };
  });
  return changed ? { ...definition, sections } : definition;
}

export function setIntentRecordsView(
  definition: IntentDefinition,
  sectionId: string,
  view: RecordsView,
): IntentDefinition {
  return mapLeafSections(definition, (section) =>
    section.kind === "records" && section.id === sectionId && section.view !== view
      ? { ...section, view }
      : section,
  );
}

/** Select an option provisionally so its additions appear without claiming a decision. */
export function chooseOption(
  definition: IntentDefinition,
  decisionId: string,
  optionId: string,
): IntentDefinition {
  return mapDecision(definition, decisionId, (item) => {
    if (!item.options.some((option) => option.id === optionId) || item.chosen === optionId) {
      return item;
    }
    return { ...item, chosen: optionId, status: "provisional" };
  });
}

/** Commit the current provisional choice. Dependencies must be settled first. */
export function recordDecision(definition: IntentDefinition, decisionId: string): IntentDefinition {
  return mapDecision(definition, decisionId, (item) =>
    item.chosen &&
    item.status !== "decided" &&
    unresolvedDependencies(definition, item).length === 0
      ? { ...item, status: "decided" }
      : item,
  );
}

/** Reopen a decided choice while retaining it for continued exploration. */
export function reopenDecision(definition: IntentDefinition, decisionId: string): IntentDefinition {
  return mapDecision(definition, decisionId, (item) =>
    item.chosen && item.status !== "provisional" ? { ...item, status: "provisional" } : item,
  );
}

/** Clear an explored choice and return the decision to its honest open state. */
export function clearDecision(definition: IntentDefinition, decisionId: string): IntentDefinition {
  return mapDecision(definition, decisionId, (item) =>
    item.chosen === null && item.status === "open"
      ? item
      : {
          ...item,
          chosen: null,
          status: "open",
        },
  );
}

/** Reopen a settled factual question without changing how it should be investigated. */
export function reopenQuestion(definition: IntentDefinition, questionId: string): IntentDefinition {
  return mapLeafSections(definition, (section) => {
    if (section.kind !== "questions") return section;
    let changed = false;
    const items = section.items.map((item) => {
      if (item.id !== questionId || item.resolution === undefined) return item;
      changed = true;
      const { resolution: _resolution, ...open } = item;
      return open;
    });
    return changed ? { ...section, items } : section;
  });
}

/** Update one record's editable content while preserving its stable graph identity. */
export function updateIntentRecord(
  definition: IntentDefinition,
  recordId: string,
  update: IntentRecordUpdate,
): IntentDefinition {
  return mapLeafSections(definition, (section) => {
    if (section.kind === "records") {
      let changed = false;
      const items = section.items.map((item) => {
        if (item.id !== recordId) return item;
        changed = true;
        return { id: item.id, ...update };
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
          return { sectionId: addition.sectionId, id: addition.id, ...update };
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

/** Update one work item while preserving its stable graph identity. */
export function updateIntentWork(
  definition: IntentDefinition,
  itemId: string,
  update: WorkItemUpdate,
): IntentDefinition {
  return mapLeafSections(definition, (section) => {
    if (section.kind !== "sequence") return section;
    if ("items" in section) {
      let changed = false;
      const items = section.items.map((item) => {
        if (item.id !== itemId) return item;
        changed = true;
        return { id: item.id, ...update };
      });
      return changed ? { ...section, items } : section;
    }

    let changed = false;
    const stages = section.stages.map((stage) => {
      const items = stage.items.map((item) => {
        if (item.id !== itemId) return item;
        changed = true;
        return { id: item.id, ...update };
      });
      return items.some((item, index) => item !== stage.items[index]) ? { ...stage, items } : stage;
    });
    return changed ? { ...section, stages } : section;
  });
}

/** Update one exhibit's exact detail while preserving its stable graph identity. */
export function updateIntentExhibit(
  definition: IntentDefinition,
  exhibitId: string,
  update: IntentExhibitUpdate,
): IntentDefinition {
  return mapLeafSections(definition, (section) => {
    if (section.kind !== "exhibits") return section;
    let changed = false;
    const items = section.items.map((item) => {
      if (item.id !== exhibitId) return item;
      changed = true;
      return { id: item.id, ...update };
    });
    return changed ? { ...section, items } : section;
  });
}

/** Remove one proposed shared item without touching established or option-owned content. */
export function removeNewSharedItem(
  definition: IntentDefinition,
  sectionId: string,
  itemId: string,
): IntentDefinition {
  const index = buildIntentIndex(definition.sections);
  const recordItem = index.recordsSectionsById
    .get(sectionId)
    ?.items.find((candidate) => candidate.id === itemId);
  const sequenceSection = index.sequences.find((section) => section.id === sectionId);
  const workItem = sequenceSection
    ? workItems(sequenceSection).find((candidate) => candidate.id === itemId)
    : undefined;
  if ((!recordItem || recordItem.change !== "new") && !workItem) return definition;
  if (workItem && sequenceSection && workItems(sequenceSection).length === 1) {
    return definition;
  }

  const removedRelationIds = new Set(
    [
      ...definition.relations,
      ...index.decisions.flatMap((decision) =>
        decision.options.flatMap((option) => option.relations),
      ),
    ]
      .filter((relation) => relationReferences(relation, itemId))
      .map((relation) => relation.id),
  );
  const withoutItem = mapLeafSections(definition, (section) => {
    if (section.kind === "records") {
      if (section.id !== sectionId) return section;
      return {
        ...section,
        items: section.items.filter((candidate) => candidate.id !== itemId),
      };
    }
    if (section.kind === "sequence") {
      if (section.id !== sectionId) return section;
      if ("stages" in section) {
        const stages = section.stages.flatMap((stage) => {
          const items = stage.items.filter((candidate) => candidate.id !== itemId);
          return items.length > 0 ? [{ ...stage, items }] : [];
        });
        return { ...section, stages };
      }
      return {
        ...section,
        items: section.items.filter((candidate) => candidate.id !== itemId),
      };
    }
    if (section.kind === "questions") {
      const items = section.items.map((question) => {
        const affects = question.affects.filter((entityId) => entityId !== itemId);
        return affects.length === question.affects.length ? question : { ...question, affects };
      });
      return items.every((question, index) => question === section.items[index])
        ? section
        : { ...section, items };
    }
    if (section.kind === "decisions") {
      const items = section.items.map((decision) => {
        const affects = decision.affects.filter((entityId) => entityId !== itemId);
        const options = decision.options.map((option) => {
          const relations = option.relations.filter(
            (relation) => !relationReferences(relation, itemId),
          );
          return relations.length === option.relations.length ? option : { ...option, relations };
        });
        return affects.length === decision.affects.length &&
          options.every((option, index) => option === decision.options[index])
          ? decision
          : { ...decision, affects, options };
      });
      return items.every((decision, index) => decision === section.items[index])
        ? section
        : { ...section, items };
    }
    return section;
  });
  const relations = withoutItem.relations.filter(
    (relation) => !relationReferences(relation, itemId),
  );
  const remainingIndex = buildIntentIndex(withoutItem.sections);
  const remainingRelationsById = new Map(
    [
      ...relations,
      ...remainingIndex.decisions.flatMap((decision) =>
        decision.options.flatMap((option) => option.relations),
      ),
    ].map((relation) => [relation.id, relation]),
  );
  const sections = withoutItem.sections.flatMap((section): IntentSection[] => {
    if (section.kind !== "map") return [section];
    if (section.layout === "paths") {
      const paths = section.paths.filter((path) =>
        path.relations.every((relationId) => !removedRelationIds.has(relationId)),
      );
      if (paths.length === 0) return [];

      const pathEntityKeys = new Set(
        paths.flatMap((path) =>
          path.relations.flatMap((relationId) => {
            const relation = remainingRelationsById.get(relationId);
            return relation ? [relation.from, relation.to] : [];
          }),
        ),
      );
      const selectedRelations = section.relations?.filter((relationId) => {
        const relation = remainingRelationsById.get(relationId);
        return Boolean(
          relation && pathEntityKeys.has(relation.from) && pathEntityKeys.has(relation.to),
        );
      });
      const regions = section.regions?.flatMap((region) => {
        const entities = region.entities.filter((entityId) => pathEntityKeys.has(entityId));
        return entities.length > 0 ? [{ ...region, entities }] : [];
      });
      const {
        paths: _previousPaths,
        regions: _previousRegions,
        relations: _previousRelations,
        ...sectionFields
      } = section;
      return [
        {
          ...sectionFields,
          paths,
          ...(regions && regions.length > 0 ? { regions } : {}),
          ...(selectedRelations && selectedRelations.length > 0
            ? { relations: selectedRelations }
            : {}),
        },
      ];
    }

    const roots = section.roots?.filter((entityId) => entityId !== itemId);
    const selectedRelations = section.relations?.filter(
      (relationId) => !removedRelationIds.has(relationId),
    );
    if (
      (section.roots && roots?.length === 0) ||
      (section.relations && selectedRelations?.length === 0)
    ) {
      return [];
    }
    return [
      {
        ...section,
        ...(roots ? { roots } : {}),
        ...(selectedRelations ? { relations: selectedRelations } : {}),
      },
    ];
  });
  return { ...withoutItem, sections, relations };
}

function relationReferences(relation: IntentRelation, entity: string): boolean {
  return relation.from === entity || relation.to === entity;
}

function mapDecision(
  definition: IntentDefinition,
  decisionId: string,
  transition: (item: Decision) => Decision,
): IntentDefinition {
  return mapLeafSections(definition, (section) => {
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

function mapLeafSections(
  definition: IntentDefinition,
  transition: (section: LeafSection) => LeafSection,
): IntentDefinition {
  let changed = false;
  const sections = definition.sections.map((section) => {
    if (section.kind === "map") return section;
    if (section.kind !== "group") {
      const next = transition(section);
      changed = changed || next !== section;
      return next;
    }

    let groupChanged = false;
    const children = section.sections.map((child) => {
      const next = transition(child);
      groupChanged = groupChanged || next !== child;
      return next;
    });
    changed = changed || groupChanged;
    return groupChanged ? { ...section, sections: children } : section;
  });
  return changed ? { ...definition, sections } : definition;
}
