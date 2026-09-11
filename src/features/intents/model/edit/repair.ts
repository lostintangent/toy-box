import { buildIntentIndex } from "../query/structure";
import type {
  FlowExhibit,
  IntentDocument,
  IntentExhibit,
  OptionRelationship,
  IntentSection,
  PlanSection,
} from "../schema";
import { flowConnectionsReachableFrom, flowNodeId } from "../spec/flow";
import { transformSections } from "./sections";

/**
 * Restore every reference invariant invalidated by removing authoritative
 * entities. This is the closing stage of a removal transition, not a later effect.
 */
export function repairAfterEntityRemoval(
  document: IntentDocument,
  initiallyRemovedEntityIds: ReadonlySet<string>,
): IntentDocument {
  const removedEntityIds = new Set(initiallyRemovedEntityIds);
  const initialIndex = buildIntentIndex(document.sections);
  const recordSectionIds = new Set(initialIndex.recordsSections.map((section) => section.id));
  for (const addition of initialIndex.decisions.flatMap((decision) =>
    decision.options.flatMap((option) => option.adds),
  )) {
    if (!recordSectionIds.has(addition.sectionId)) removedEntityIds.add(addition.id);
  }

  let next = {
    ...document,
    sections: repairFlowSections(document.sections, removedEntityIds),
  };

  const repairedIndex = buildIntentIndex(next.sections);
  const remainingRecordSectionIds = new Set(
    repairedIndex.recordsSections.map((section) => section.id),
  );
  const keepRelationship = (relationship: OptionRelationship) =>
    !removedEntityIds.has(relationship.from) && !removedEntityIds.has(relationship.to);

  next = transformSections(next, (section) => {
    if (section.kind === "records") {
      const items = section.items.map((item) => repairGrounding(item, removedEntityIds));
      return items.some((item, index) => item !== section.items[index])
        ? { ...section, items }
        : section;
    }
    if (section.kind === "exhibits") {
      const items = section.items.map((item) => repairGrounding(item, removedEntityIds));
      return items.some((item, index) => item !== section.items[index])
        ? { ...section, items }
        : section;
    }
    if (section.kind === "questions") {
      return {
        ...section,
        items: section.items.map((question) => ({
          ...question,
          affects: question.affects.filter((entityId) => !removedEntityIds.has(entityId)),
        })),
      };
    }
    if (section.kind !== "decisions") return section;
    return {
      ...section,
      items: section.items.map((decision) =>
        repairGrounding(
          {
            ...decision,
            dependsOn: decision.dependsOn.filter((questionId) => !removedEntityIds.has(questionId)),
            affects: decision.affects.filter((entityId) => !removedEntityIds.has(entityId)),
            options: decision.options.map((option) => {
              const adds = option.adds
                .filter(
                  (addition) =>
                    !removedEntityIds.has(addition.id) &&
                    remainingRecordSectionIds.has(addition.sectionId),
                )
                .map((addition) => repairGrounding(addition, removedEntityIds));
              const relationships = (option.relationships ?? []).filter(keepRelationship);
              const exhibit = option.exhibit
                ? repairGrounding(option.exhibit, removedEntityIds)
                : undefined;
              const { relationships: _relationships, exhibit: _exhibit, ...optionFields } = option;
              return {
                ...optionFields,
                adds,
                ...(exhibit ? { exhibit } : {}),
                ...(relationships.length > 0 ? { relationships } : {}),
              };
            }),
          },
          removedEntityIds,
        ),
      ),
    };
  });
  next = {
    ...next,
    sections: repairPlansAfterRemoval(next.sections, removedEntityIds),
  };

  if (!next.tabs) return next;
  const remainingSectionIds = new Set(next.sections.map((section) => section.id));
  const tabs = next.tabs.flatMap((tab) => {
    const sections = tab.sections.filter((id) => remainingSectionIds.has(id));
    return sections.length > 0 ? [{ ...tab, sections }] : [];
  });
  if (tabs.length > 1) return { ...next, tabs };
  const { tabs: _tabs, ...withoutTabs } = next;
  return withoutTabs;
}

function repairFlowSections(
  sections: readonly IntentSection[],
  removedEntityIds: Set<string>,
): IntentSection[] {
  return sections.flatMap((section): IntentSection[] => {
    if (section.kind === "findings") {
      const items = section.items.map((finding) => {
        if (finding.exhibit?.kind !== "flow") return finding;
        const exhibit = repairFlowAfterRemoval(finding.exhibit, removedEntityIds);
        if (exhibit === finding.exhibit) return finding;
        if (exhibit) return { ...finding, exhibit };
        removedEntityIds.add(finding.exhibit.id);
        const { exhibit: _exhibit, ...withoutExhibit } = finding;
        return withoutExhibit;
      });
      return items.some((finding, index) => finding !== section.items[index])
        ? [{ ...section, items }]
        : [section];
    }
    if (section.kind === "decisions") {
      const items = section.items.map((decision) => {
        const options = decision.options.map((option) => {
          if (option.exhibit?.kind !== "flow") return option;
          const exhibit = repairFlowAfterRemoval(option.exhibit, removedEntityIds);
          if (exhibit === option.exhibit) return option;
          if (exhibit) return { ...option, exhibit };
          removedEntityIds.add(option.exhibit.id);
          const { exhibit: _exhibit, ...withoutExhibit } = option;
          return withoutExhibit;
        });
        return options.some((option, index) => option !== decision.options[index])
          ? { ...decision, options }
          : decision;
      });
      return items.some((decision, index) => decision !== section.items[index])
        ? [{ ...section, items }]
        : [section];
    }
    if (section.kind !== "exhibits") return [section];

    const items = section.items.flatMap((item): IntentExhibit[] => {
      if (item.kind !== "flow") return [item];
      const repaired = repairFlowAfterRemoval(item, removedEntityIds);
      if (repaired) return [repaired];
      removedEntityIds.add(item.id);
      return [];
    });
    if (items.length === 0) {
      removedEntityIds.add(section.id);
      return [];
    }
    return items.length === section.items.length &&
      items.every((item, index) => item === section.items[index])
      ? [section]
      : [{ ...section, items }];
  });
}

function repairGrounding<T extends { basedOn?: string[] }>(
  item: T,
  removedEntityIds: ReadonlySet<string>,
): T {
  if (!item.basedOn?.some((findingId) => removedEntityIds.has(findingId))) return item;
  const basedOn = item.basedOn.filter((findingId) => !removedEntityIds.has(findingId));
  const { basedOn: _basedOn, ...fields } = item;
  return {
    ...fields,
    ...(basedOn.length > 0 ? { basedOn } : {}),
  } as T;
}

function repairFlowAfterRemoval(
  flow: FlowExhibit,
  removedEntityIds: ReadonlySet<string>,
): FlowExhibit | undefined {
  const nodes = flow.nodes.filter(
    (node) => !("entity" in node) || !removedEntityIds.has(node.entity),
  );
  const nodeIds = new Set(nodes.map(flowNodeId));
  const candidateConnections = flow.connections.filter(
    (connection) => nodeIds.has(connection.from) && nodeIds.has(connection.to),
  );
  const connectionsById = new Map(
    candidateConnections.map((connection) => [connection.id, connection]),
  );
  const paths = flow.paths.flatMap((path) => {
    if (!nodeIds.has(path.start)) return [];
    const selected = path.connectionIds.flatMap((connectionId) => {
      const connection = connectionsById.get(connectionId);
      return connection ? [connection] : [];
    });
    const reachableConnectionIds = new Set(
      flowConnectionsReachableFrom(path.start, selected).map((connection) => connection.id),
    );
    const connectionIds = path.connectionIds.filter((connectionId) =>
      reachableConnectionIds.has(connectionId),
    );
    if (connectionIds.length === 0) return [];
    return connectionIds.length === path.connectionIds.length
      ? [path]
      : [{ ...path, connectionIds }];
  });
  if (paths.length === 0) return;

  const pathConnectionIds = new Set(paths.flatMap((path) => path.connectionIds));
  const pathNodeIds = new Set(
    [...pathConnectionIds].flatMap((connectionId) => {
      const connection = connectionsById.get(connectionId);
      return connection ? [connection.from, connection.to] : [];
    }),
  );
  const connections = candidateConnections.filter(
    (connection) =>
      pathConnectionIds.has(connection.id) ||
      (pathNodeIds.has(connection.from) && pathNodeIds.has(connection.to)),
  );
  if (connections.length === 0) return;
  const retainedNodeIds = new Set(
    connections.flatMap((connection) => [connection.from, connection.to]),
  );
  const retainedNodes = nodes.filter((node) => retainedNodeIds.has(flowNodeId(node)));
  if (retainedNodes.length < 2) return;

  const regions = flow.regions?.flatMap((region) => {
    const regionNodeIds = region.nodeIds.filter((nodeId) => pathNodeIds.has(nodeId));
    if (regionNodeIds.length === 0) return [];
    return regionNodeIds.length === region.nodeIds.length
      ? [region]
      : [{ ...region, nodeIds: regionNodeIds }];
  });
  const unchanged =
    retainedNodes.length === flow.nodes.length &&
    connections.length === flow.connections.length &&
    paths.length === flow.paths.length &&
    paths.every((path, index) => path === flow.paths[index]) &&
    (regions?.length ?? 0) === (flow.regions?.length ?? 0) &&
    (regions ?? []).every((region, index) => region === flow.regions?.[index]);
  if (unchanged) return flow;

  const { regions: _regions, ...flowFields } = flow;
  return {
    ...flowFields,
    nodes: retainedNodes,
    connections,
    paths,
    ...(regions && regions.length > 0 ? { regions } : {}),
  };
}

function repairPlansAfterRemoval(
  sections: readonly IntentSection[],
  removedEntityIds: ReadonlySet<string>,
): IntentSection[] {
  function repairPlanSection(section: PlanSection): PlanSection | undefined {
    if ("steps" in section) {
      const steps = section.steps.flatMap((step) => {
        const implementsIds = step.implements.filter((entityId) => !removedEntityIds.has(entityId));
        if (implementsIds.length === 0) return [];
        return [
          implementsIds.length === step.implements.length
            ? step
            : { ...step, implements: implementsIds },
        ];
      });
      if (steps.length === 0) return;
      const changed =
        steps.length !== section.steps.length ||
        steps.some((step, index) => step !== section.steps[index]);
      return changed ? { ...section, steps } : section;
    }

    const phases = section.phases.flatMap((phase) => {
      const steps = phase.steps.flatMap((step) => {
        const implementsIds = step.implements.filter((entityId) => !removedEntityIds.has(entityId));
        if (implementsIds.length === 0) return [];
        return [
          implementsIds.length === step.implements.length
            ? step
            : { ...step, implements: implementsIds },
        ];
      });
      if (steps.length === 0) return [];
      const changed =
        steps.length !== phase.steps.length ||
        steps.some((step, index) => step !== phase.steps[index]);
      return [changed ? { ...phase, steps } : phase];
    });
    if (phases.length === 0) return;
    const changed =
      phases.length !== section.phases.length ||
      phases.some((phase, index) => phase !== section.phases[index]);
    return changed ? { ...section, phases } : section;
  }

  return sections.flatMap((section): IntentSection[] => {
    if (section.kind === "plan") {
      const repaired = repairPlanSection(section);
      return repaired ? [repaired] : [];
    }
    return [section];
  });
}
