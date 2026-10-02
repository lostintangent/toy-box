import { buildBriefIndex } from "../query/structure";
import type {
  BriefDocument,
  BriefExhibit,
  BriefSection,
  Decision,
  DecisionOption,
  FlowExhibit,
  PlanSection,
  PlanStep,
} from "../schema";
import { flowConnectionsReachableFrom, flowNodeId } from "../spec/flow";
import { mapEach } from "./immutable";

/**
 * Restore every reference invariant invalidated by removing authoritative
 * entities. This is the closing stage of a removal transition, not a later effect.
 */
export function repairAfterEntityRemoval(
  document: BriefDocument,
  initiallyRemovedEntityIds: ReadonlySet<string>,
): BriefDocument {
  const removedEntityIds = new Set(initiallyRemovedEntityIds);
  const index = buildBriefIndex(document.sections);
  const recordSectionIds = new Set(index.recordsSections.map((section) => section.id));
  for (const addition of index.decisions.flatMap((decision) =>
    decision.options.flatMap((option) => option.adds),
  )) {
    if (!recordSectionIds.has(addition.sectionId)) removedEntityIds.add(addition.id);
  }

  // Flow repair can remove further exhibits, so it settles the removed set first.
  const withRepairedFlows = repairFlows(document, removedEntityIds);
  return repairTabs(
    mapEach(withRepairedFlows, "sections", (section) =>
      repairReferences(section, removedEntityIds),
    ),
  );
}

function repairFlows(document: BriefDocument, removedEntityIds: Set<string>): BriefDocument {
  const repairOwnedFlow = <Owner extends { exhibit?: BriefExhibit }>(owner: Owner): Owner => {
    if (owner.exhibit?.kind !== "flow") return owner;
    const exhibit = repairFlowAfterRemoval(owner.exhibit, removedEntityIds);
    if (exhibit === owner.exhibit) return owner;
    if (exhibit) return { ...owner, exhibit };
    removedEntityIds.add(owner.exhibit.id);
    const { exhibit: _exhibit, ...withoutExhibit } = owner;
    return withoutExhibit as Owner;
  };

  return mapEach(document, "sections", (section) => {
    if (section.kind === "findings") return mapEach(section, "items", repairOwnedFlow);
    if (section.kind === "decisions") {
      return mapEach(section, "items", (decision) => mapEach(decision, "options", repairOwnedFlow));
    }
    if (section.kind !== "exhibits") return section;

    const repaired = mapEach(section, "items", (item) => {
      if (item.kind !== "flow") return item;
      const flow = repairFlowAfterRemoval(item, removedEntityIds);
      if (!flow) removedEntityIds.add(item.id);
      return flow;
    });
    if (repaired.items.length > 0) return repaired;
    removedEntityIds.add(section.id);
    return undefined;
  });
}

function repairReferences(
  section: BriefSection,
  removedEntityIds: ReadonlySet<string>,
): BriefSection | undefined {
  switch (section.kind) {
    case "records":
      return mapEach(section, "items", (item) => repairGrounding(item, removedEntityIds));
    case "exhibits":
      return mapEach(section, "items", (item) => repairGrounding(item, removedEntityIds));
    case "questions":
      return mapEach(section, "items", (question) =>
        mapEach(question, "affects", surviving(removedEntityIds)),
      );
    case "decisions":
      return mapEach(section, "items", (decision) => repairDecision(decision, removedEntityIds));
    case "plan":
      return repairPlan(section, removedEntityIds);
    default:
      return section;
  }
}

function repairDecision(decision: Decision, removedEntityIds: ReadonlySet<string>): Decision {
  const repairOption = (option: DecisionOption): DecisionOption => {
    let next = mapEach(option, "adds", (addition) =>
      removedEntityIds.has(addition.id) ? undefined : repairGrounding(addition, removedEntityIds),
    );
    if (next.exhibit) {
      const exhibit = repairGrounding(next.exhibit, removedEntityIds);
      if (exhibit !== next.exhibit) next = { ...next, exhibit };
    }
    const related = mapEach(next, "relationships", (relationship) =>
      removedEntityIds.has(relationship.from) || removedEntityIds.has(relationship.to)
        ? undefined
        : relationship,
    );
    return withoutEmpty(related, "relationships");
  };

  const repaired = mapEach(
    mapEach(
      mapEach(decision, "dependsOn", surviving(removedEntityIds)),
      "affects",
      surviving(removedEntityIds),
    ),
    "options",
    repairOption,
  );
  return repairGrounding(repaired, removedEntityIds);
}

function repairPlan(
  section: PlanSection,
  removedEntityIds: ReadonlySet<string>,
): PlanSection | undefined {
  const repairStep = (step: PlanStep) => {
    const repaired = mapEach(step, "implements", surviving(removedEntityIds));
    return repaired.implements.length > 0 ? repaired : undefined;
  };
  if ("steps" in section) {
    const repaired = mapEach(section, "steps", repairStep);
    return repaired.steps.length > 0 ? repaired : undefined;
  }
  const repaired = mapEach(section, "phases", (phase) => {
    const next = mapEach(phase, "steps", repairStep);
    return next.steps.length > 0 ? next : undefined;
  });
  return repaired.phases.length > 0 ? repaired : undefined;
}

function repairTabs(document: BriefDocument): BriefDocument {
  if (!document.tabs) return document;
  const remainingSectionIds = new Set(document.sections.map((section) => section.id));
  const tabs = document.tabs.flatMap((tab) => {
    const sections = tab.sections.filter((id) => remainingSectionIds.has(id));
    return sections.length > 0 ? [{ ...tab, sections }] : [];
  });
  if (tabs.length > 1) return { ...document, tabs };
  const { tabs: _tabs, ...withoutTabs } = document;
  return withoutTabs;
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

/**
 * Keep the routes that still start at a present node, then only the connections,
 * nodes, and regions those routes still need. A flow without a route is removed.
 */
function repairFlowAfterRemoval(
  flow: FlowExhibit,
  removedEntityIds: ReadonlySet<string>,
): FlowExhibit | undefined {
  const present = mapEach(flow, "nodes", (node) =>
    "entity" in node && removedEntityIds.has(node.entity) ? undefined : node,
  );
  const nodeIds = new Set(present.nodes.map(flowNodeId));
  const connected = mapEach(present, "connections", (connection) =>
    nodeIds.has(connection.from) && nodeIds.has(connection.to) ? connection : undefined,
  );
  const connectionsById = new Map(
    connected.connections.map((connection) => [connection.id, connection]),
  );
  const routed = mapEach(connected, "paths", (path) => {
    if (!nodeIds.has(path.start)) return undefined;
    const selected = path.connectionIds.flatMap((id) => connectionsById.get(id) ?? []);
    const reachableIds = new Set(
      flowConnectionsReachableFrom(path.start, selected).map((connection) => connection.id),
    );
    const next = mapEach(path, "connectionIds", (id) => (reachableIds.has(id) ? id : undefined));
    return next.connectionIds.length > 0 ? next : undefined;
  });
  if (routed.paths.length === 0) return undefined;

  const pathConnectionIds = new Set(routed.paths.flatMap((path) => path.connectionIds));
  const pathNodeIds = new Set(
    [...pathConnectionIds].flatMap((id) => {
      const connection = connectionsById.get(id);
      return connection ? [connection.from, connection.to] : [];
    }),
  );
  const supporting = mapEach(routed, "connections", (connection) =>
    pathConnectionIds.has(connection.id) ||
    (pathNodeIds.has(connection.from) && pathNodeIds.has(connection.to))
      ? connection
      : undefined,
  );
  const retainedNodeIds = new Set(
    supporting.connections.flatMap((connection) => [connection.from, connection.to]),
  );
  const retained = mapEach(supporting, "nodes", (node) =>
    retainedNodeIds.has(flowNodeId(node)) ? node : undefined,
  );
  if (retained.nodes.length < 2) return undefined;

  const regioned = mapEach(retained, "regions", (region) => {
    const next = mapEach(region, "nodeIds", (id) => (pathNodeIds.has(id) ? id : undefined));
    return next.nodeIds.length > 0 ? next : undefined;
  });
  return withoutEmpty(regioned, "regions");
}

/** A reference survives removal only when its entity does. */
function surviving(removedEntityIds: ReadonlySet<string>) {
  return (id: string) => (removedEntityIds.has(id) ? undefined : id);
}

/** Optional authored lists are omitted rather than left empty. */
function withoutEmpty<Owner extends object>(owner: Owner, key: keyof Owner): Owner {
  const value = owner[key];
  if (!Array.isArray(value) || value.length > 0) return owner;
  const { [key]: _empty, ...rest } = owner;
  return rest as Owner;
}
