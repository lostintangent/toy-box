import { addDuplicateIssues, addEntityReferenceIssue, type RefinementContext } from "../issues";
import { intentEntitiesFrom, type IntentEntity } from "../query/reading";
import { buildIntentIndex } from "../query/structure";
import type {
  Change,
  FlowConnection,
  FlowExhibit,
  FlowNode,
  FlowPath,
  IntentDocument,
  IntentEntityId,
} from "../schema";

/**
 * An authoritative directed flow. The exhibit owns its local nodes, connections,
 * paths, and regions while shared nodes continue to resolve through document
 * entity identity so decisions, inspectors, and plan steps can address them.
 */

export type FlowGraphNode = {
  id: string;
  label: string;
  detail?: string;
  change?: Change;
  entity?: IntentEntity;
  incoming: FlowConnection[];
  outgoing: FlowConnection[];
};

type FlowGraphPath = {
  id: string;
  title: string;
  purpose: string;
  start: string;
  connections: FlowConnection[];
  nodes: FlowGraphNode[];
};

type FlowGraphRegion = {
  id: string;
  title: string;
  nodes: FlowGraphNode[];
};

export type FlowGraph = {
  connections: FlowConnection[];
  stages: FlowGraphNode[][];
  paths: FlowGraphPath[];
  regions: FlowGraphRegion[];
};

export type EntityFlowConnection = {
  flow: FlowExhibit;
  connection: FlowConnection;
  outgoing: boolean;
  related: FlowGraphNode;
};

export function flowNodeId(node: FlowNode): string {
  return "entity" in node ? node.entity : node.id;
}

export function addFlowIssues(
  flow: FlowExhibit,
  sharedEntityIds: ReadonlySet<string>,
  ctx: RefinementContext,
  path: PropertyKey[],
): void {
  const nodeIds = flow.nodes.map(flowNodeId);
  const nodes = new Set(nodeIds);
  addDuplicateIssues(nodeIds, ctx, [...path, "nodes"], `Nodes in flow "${flow.title}"`);

  flow.nodes.forEach((node, nodeIndex) => {
    if (!("entity" in node)) return;
    const entityPath = [...path, "nodes", nodeIndex, "entity"];
    if (node.entity === flow.id) {
      ctx.addIssue({
        code: "custom",
        message: `Flow "${flow.id}" cannot contain itself as a shared node.`,
        path: entityPath,
      });
      return;
    }
    addEntityReferenceIssue(node.entity, sharedEntityIds, ctx, entityPath);
  });

  addDuplicateIssues(
    flow.connections.map((connection) => connection.id),
    ctx,
    [...path, "connections"],
    `Connections in flow "${flow.title}"`,
  );
  const connectionsById = new Map(
    flow.connections.map((connection) => [connection.id, connection]),
  );
  const connectedNodeIds = new Set<string>();
  flow.connections.forEach((connection, connectionIndex) => {
    const connectionPath = [...path, "connections", connectionIndex];
    addNodeReferenceIssue(connection.from, nodes, flow, ctx, [...connectionPath, "from"]);
    addNodeReferenceIssue(connection.to, nodes, flow, ctx, [...connectionPath, "to"]);
    if (connection.from === connection.to) {
      ctx.addIssue({
        code: "custom",
        message: `Connection "${connection.id}" cannot connect a node to itself.`,
        path: connectionPath,
      });
    }
    connectedNodeIds.add(connection.from);
    connectedNodeIds.add(connection.to);
  });
  flow.nodes.forEach((node, nodeIndex) => {
    const nodeId = flowNodeId(node);
    if (connectedNodeIds.has(nodeId)) return;
    ctx.addIssue({
      code: "custom",
      message: `Node "${nodeId}" is not used by a connection in flow "${flow.id}".`,
      path: [...path, "nodes", nodeIndex],
    });
  });

  addDuplicateIssues(
    flow.paths.map((item) => item.id),
    ctx,
    [...path, "paths"],
    `Paths in flow "${flow.title}"`,
  );
  const pathConnectionIds = new Set<string>();
  const pathConnections: FlowConnection[] = [];
  const pathNodeIds = new Set<string>();
  flow.paths.forEach((item, pathIndex) => {
    const itemPath = [...path, "paths", pathIndex];
    addNodeReferenceIssue(item.start, nodes, flow, ctx, [...itemPath, "start"]);
    addDuplicateIssues(
      item.connectionIds,
      ctx,
      [...itemPath, "connectionIds"],
      `Connections in path "${item.title}"`,
    );

    const selected = item.connectionIds.flatMap((connectionId, connectionIndex) => {
      const connection = connectionsById.get(connectionId);
      if (connection) return [{ connection, connectionIndex }];
      ctx.addIssue({
        code: "custom",
        message: `Path "${item.id}" references unknown connection "${connectionId}".`,
        path: [...itemPath, "connectionIds", connectionIndex],
      });
      return [];
    });
    const selectedConnections = selected.map(({ connection }) => connection);
    const endpointIds = new Set(
      selectedConnections.flatMap((connection) => [connection.from, connection.to]),
    );
    if (!endpointIds.has(item.start)) {
      ctx.addIssue({
        code: "custom",
        message: `Path "${item.id}" must start from a node in its connections.`,
        path: [...itemPath, "start"],
      });
    }

    const reachableConnectionIds = new Set(
      flowConnectionsReachableFrom(item.start, selectedConnections).map(
        (connection) => connection.id,
      ),
    );
    selected.forEach(({ connection, connectionIndex }) => {
      if (reachableConnectionIds.has(connection.id)) return;
      ctx.addIssue({
        code: "custom",
        message: `Connection "${connection.id}" is not reachable outward from path start "${item.start}".`,
        path: [...itemPath, "connectionIds", connectionIndex],
      });
    });

    for (const connection of selectedConnections) {
      if (!pathConnectionIds.has(connection.id)) pathConnections.push(connection);
      pathConnectionIds.add(connection.id);
      pathNodeIds.add(connection.from);
      pathNodeIds.add(connection.to);
    }
  });

  flow.connections.forEach((connection, connectionIndex) => {
    if (pathConnectionIds.has(connection.id)) return;
    if (pathNodeIds.has(connection.from) && pathNodeIds.has(connection.to)) return;
    ctx.addIssue({
      code: "custom",
      message: `Supporting connection "${connection.id}" must connect nodes already placed by a path.`,
      path: [...path, "connections", connectionIndex],
    });
  });

  if (flow.regions) {
    addDuplicateIssues(
      flow.regions.map((region) => region.id),
      ctx,
      [...path, "regions"],
      `Regions in flow "${flow.title}"`,
    );
    addDuplicateIssues(
      flow.regions.flatMap((region) => region.nodeIds),
      ctx,
      [...path, "regions"],
      `Region members in flow "${flow.title}"`,
    );
    flow.regions.forEach((region, regionIndex) => {
      region.nodeIds.forEach((nodeId, nodeIndex) => {
        const nodePath = [...path, "regions", regionIndex, "nodeIds", nodeIndex];
        addNodeReferenceIssue(nodeId, nodes, flow, ctx, nodePath);
        if (pathNodeIds.has(nodeId)) return;
        ctx.addIssue({
          code: "custom",
          message: `Region "${region.id}" can contain only nodes placed by a path.`,
          path: nodePath,
        });
      });
    });
  }

  const cycle = connectionCycle(pathNodeIds, pathConnections);
  if (cycle) {
    ctx.addIssue({
      code: "custom",
      message: `Paths in flow "${flow.id}" contain a cycle: ${cycle.join(" -> ")}.`,
      path: [...path, "paths"],
    });
  }
}

export function flowGraph(document: IntentDocument, flow: FlowExhibit): FlowGraph {
  const index = buildIntentIndex(document.sections);
  const sharedEntities = new Map(intentEntitiesFrom(index).map((entity) => [entity.id, entity]));
  const authoredNodes = flow.nodes.flatMap((node): FlowGraphNode[] => {
    if ("entity" in node) {
      const entity = sharedEntities.get(node.entity);
      if (!entity) return [];
      return [
        {
          id: entity.id,
          label: entity.label,
          ...(entity.detail ? { detail: entity.detail } : {}),
          ...(entityHasChange(entity) ? { change: entity.change } : {}),
          entity,
          incoming: [],
          outgoing: [],
        },
      ];
    }
    return [
      {
        id: node.id,
        label: node.title,
        ...(node.description ? { detail: node.description } : {}),
        ...(node.change ? { change: node.change } : {}),
        incoming: [],
        outgoing: [],
      },
    ];
  });
  const nodesById = new Map(authoredNodes.map((node) => [node.id, node]));
  for (const connection of flow.connections) {
    const from = nodesById.get(connection.from);
    const to = nodesById.get(connection.to);
    if (from) from.outgoing.push(connection);
    if (to) to.incoming.push(connection);
  }

  const projectedPaths = flow.paths.map((path) => ({
    path,
    connections: projectedPathConnections(path, flow.connections),
  }));
  const pathConnections = uniqueConnections(projectedPaths.flatMap((path) => path.connections));
  const stageById = flowPathStages(
    authoredNodes.map((node) => node.id),
    pathConnections,
  );
  const stages: FlowGraphNode[][] = [];
  for (const node of authoredNodes) {
    const stage = stageById.get(node.id) ?? 0;
    const stageNodes = stages[stage] ?? [];
    stageNodes.push(node);
    stages[stage] = stageNodes;
  }
  const compactStages = stages.filter(Boolean);
  const nodes = compactStages.flat();
  const paths = projectedPaths.map(({ path, connections }) => {
    const nodeIds = new Set(connections.flatMap((connection) => [connection.from, connection.to]));
    return {
      id: path.id,
      title: path.title,
      purpose: path.purpose,
      start: path.start,
      connections,
      nodes: nodes.filter((node) => nodeIds.has(node.id)),
    };
  });
  const regions = (flow.regions ?? []).flatMap((region) => {
    const regionNodes = region.nodeIds.flatMap((nodeId) => {
      const node = nodesById.get(nodeId);
      return node ? [node] : [];
    });
    return regionNodes.length > 0
      ? [{ id: region.id, title: region.title, nodes: regionNodes }]
      : [];
  });
  return { connections: flow.connections, stages: compactStages, paths, regions };
}

export function flowPathSelectionAfterInspection(
  graph: FlowGraph,
  selectedPathId: string | undefined,
  nodeId: string,
): string | undefined {
  if (selectedPathId === undefined) return undefined;
  const selectedPath = graph.paths.find((path) => path.id === selectedPathId);
  if (selectedPath?.nodes.some((node) => node.id === nodeId)) return selectedPathId;
  return (
    graph.paths.find((path) => path.nodes.some((node) => node.id === nodeId))?.id ?? selectedPathId
  );
}

export function entityFlowConnections(
  document: IntentDocument,
  entityId: IntentEntityId,
): EntityFlowConnection[] {
  const index = buildIntentIndex(document.sections);
  return index.sectionExhibits.flatMap((exhibit) => {
    if (exhibit.kind !== "flow") return [];
    const graph = flowGraph(document, exhibit);
    const node = graph.stages.flat().find((candidate) => candidate.entity?.id === entityId);
    if (!node) return [];
    const nodesById = new Map(graph.stages.flat().map((candidate) => [candidate.id, candidate]));
    return [
      ...node.outgoing.flatMap((connection) => {
        const related = nodesById.get(connection.to);
        return related ? [{ flow: exhibit, connection, outgoing: true, related }] : [];
      }),
      ...node.incoming.flatMap((connection) => {
        const related = nodesById.get(connection.from);
        return related ? [{ flow: exhibit, connection, outgoing: false, related }] : [];
      }),
    ];
  });
}

function addNodeReferenceIssue(
  nodeId: string,
  knownNodes: ReadonlySet<string>,
  flow: FlowExhibit,
  ctx: RefinementContext,
  path: PropertyKey[],
): void {
  if (knownNodes.has(nodeId)) return;
  ctx.addIssue({
    code: "custom",
    message: `Flow "${flow.id}" references unknown node "${nodeId}".`,
    path,
  });
}

function entityHasChange(
  entity: IntentEntity,
): entity is Extract<IntentEntity, { change: Change }> {
  return "change" in entity;
}

function projectedPathConnections(
  path: FlowPath,
  available: readonly FlowConnection[],
): FlowConnection[] {
  const availableById = new Map(available.map((connection) => [connection.id, connection]));
  const candidates = path.connectionIds.flatMap((connectionId) => {
    const connection = availableById.get(connectionId);
    return connection ? [connection] : [];
  });
  return flowConnectionsReachableFrom(path.start, candidates);
}

export function flowConnectionsReachableFrom(
  start: string,
  connections: readonly FlowConnection[],
): FlowConnection[] {
  const outgoing = new Map<string, FlowConnection[]>();
  for (const connection of connections) {
    outgoing.set(connection.from, [...(outgoing.get(connection.from) ?? []), connection]);
  }

  const queue = [start];
  const visitedNodes = new Set(queue);
  const visitedConnections = new Set<string>();
  const projected: FlowConnection[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    for (const connection of outgoing.get(queue[index]!) ?? []) {
      if (visitedConnections.has(connection.id)) continue;
      visitedConnections.add(connection.id);
      projected.push(connection);
      if (visitedNodes.has(connection.to)) continue;
      visitedNodes.add(connection.to);
      queue.push(connection.to);
    }
  }
  return projected;
}

function uniqueConnections(connections: readonly FlowConnection[]): FlowConnection[] {
  const seen = new Set<string>();
  return connections.filter((connection) => {
    if (seen.has(connection.id)) return false;
    seen.add(connection.id);
    return true;
  });
}

function connectionCycle(
  nodeIds: ReadonlySet<string>,
  connections: readonly FlowConnection[],
): string[] | undefined {
  const outgoing = new Map<string, string[]>();
  for (const nodeId of nodeIds) outgoing.set(nodeId, []);
  for (const connection of connections) outgoing.get(connection.from)?.push(connection.to);

  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];
  function visit(nodeId: string): string[] | undefined {
    if (active.has(nodeId)) {
      const start = path.indexOf(nodeId);
      return [...path.slice(start), nodeId];
    }
    if (visited.has(nodeId)) return;
    active.add(nodeId);
    path.push(nodeId);
    for (const target of outgoing.get(nodeId) ?? []) {
      const cycle = visit(target);
      if (cycle) return cycle;
    }
    path.pop();
    active.delete(nodeId);
    visited.add(nodeId);
  }

  for (const nodeId of nodeIds) {
    const cycle = visit(nodeId);
    if (cycle) return cycle;
  }
}

function flowPathStages(
  nodeOrder: readonly string[],
  connections: readonly FlowConnection[],
): Map<string, number> {
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, FlowConnection[]>();
  for (const nodeId of nodeOrder) incomingCount.set(nodeId, 0);
  for (const connection of connections) {
    outgoing.set(connection.from, [...(outgoing.get(connection.from) ?? []), connection]);
    incomingCount.set(connection.to, (incomingCount.get(connection.to) ?? 0) + 1);
  }

  const queue = nodeOrder.filter((nodeId) => (incomingCount.get(nodeId) ?? 0) === 0);
  const stageById = new Map(queue.map((nodeId) => [nodeId, 0]));
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index]!;
    for (const connection of outgoing.get(source) ?? []) {
      stageById.set(
        connection.to,
        Math.max(stageById.get(connection.to) ?? 0, (stageById.get(source) ?? 0) + 1),
      );
      const remaining = (incomingCount.get(connection.to) ?? 1) - 1;
      incomingCount.set(connection.to, remaining);
      if (remaining === 0) queue.push(connection.to);
    }
  }

  for (const nodeId of nodeOrder) {
    if (!stageById.has(nodeId)) stageById.set(nodeId, 0);
  }
  return stageById;
}
