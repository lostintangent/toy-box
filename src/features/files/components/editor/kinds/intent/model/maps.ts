import { addDuplicateIssues, addEntityReferenceIssue, type RefinementContext } from "./issues";
import {
  effectiveRelationsFrom,
  intentEntitiesFrom,
  type EffectiveRelation,
  type IntentEntity,
} from "./projection";
import { buildIntentIndex, sectionPath, type IntentIndex } from "./read";
import {
  authoredRelations,
  projectOutwardRelations,
  relationCycle,
  relationshipMapCandidates,
} from "./relations";
import { workItems } from "./sequence";
import type {
  IntentDefinition,
  IntentEntityId,
  IntentMapPath,
  IntentRelation,
  MapSection,
} from "./schema";

/**
 * Task-authored graph readings: the rules that keep a map an honest lens over
 * existing entities, and the projection that turns one selection into ordered
 * stages, rooted paths, and exclusive regions without duplicating a node.
 */

export type IntentMapGraphNode = {
  entity: IntentEntity;
  incoming: EffectiveRelation[];
  outgoing: EffectiveRelation[];
};

export type IntentMapGraphPath = {
  id: string;
  title: string;
  purpose: string;
  root: IntentEntityId;
  relations: EffectiveRelation[];
  nodes: IntentMapGraphNode[];
};

type IntentMapGraphRegion = {
  id: string;
  title: string;
  nodes: IntentMapGraphNode[];
};

export type IntentMapGraph = {
  relations: EffectiveRelation[];
  stages: IntentMapGraphNode[][];
  paths: IntentMapGraphPath[];
  regions: IntentMapGraphRegion[];
};

/** Maps select existing readable relationships; they never introduce their own. */
export function addMapIssues(
  maps: readonly MapSection[],
  entities: ReadonlySet<string>,
  readableRelations: readonly IntentRelation[],
  ctx: RefinementContext,
): void {
  const readableRelationIds = new Set(readableRelations.map((relation) => relation.id));
  const readableRelationsById = new Map(
    readableRelations.map((relation) => [relation.id, relation]),
  );

  maps.forEach((map) => {
    const path = sectionPath(map);
    if (map.layout === "paths") {
      addDuplicateIssues(
        map.paths.map((item) => item.id),
        ctx,
        [...path, "paths"],
        `Paths in map "${map.title}"`,
      );

      const pathRelationIds = new Set<string>();
      const pathRelations: IntentRelation[] = [];
      const pathEntityKeys = new Set<string>();
      map.paths.forEach((item, pathIndex) => {
        const itemPath = [...path, "paths", pathIndex];
        addEntityReferenceIssue(item.root, entities, ctx, [...itemPath, "root"]);
        addDuplicateIssues(
          item.relations,
          ctx,
          [...itemPath, "relations"],
          `Relationships in path "${item.title}"`,
        );

        const selected = item.relations.flatMap((relationId, relationIndex) => {
          const relation = readableRelationsById.get(relationId);
          if (relation) return [{ relation, relationIndex }];
          ctx.addIssue({
            code: "custom",
            message: `Path "${item.id}" references unknown or delivery-only relationship "${relationId}".`,
            path: [...itemPath, "relations", relationIndex],
          });
          return [];
        });
        const selectedRelations = selected.map(({ relation }) => relation);
        const endpointKeys = new Set(
          selectedRelations.flatMap((relation) => [relation.from, relation.to]),
        );
        if (!endpointKeys.has(item.root)) {
          ctx.addIssue({
            code: "custom",
            message: `Path "${item.id}" must start from an endpoint in its relationships.`,
            path: [...itemPath, "root"],
          });
        }

        const reachableRelations = new Set(
          projectOutwardRelations([item.root], selectedRelations).map((relation) => relation.id),
        );
        selected.forEach(({ relation, relationIndex }) => {
          if (reachableRelations.has(relation.id)) return;
          ctx.addIssue({
            code: "custom",
            message: `Relationship "${relation.id}" is not reachable outward from path root "${item.root}".`,
            path: [...itemPath, "relations", relationIndex],
          });
        });

        for (const relation of selectedRelations) {
          if (!pathRelationIds.has(relation.id)) pathRelations.push(relation);
          pathRelationIds.add(relation.id);
          pathEntityKeys.add(relation.from);
          pathEntityKeys.add(relation.to);
        }
      });

      if (map.relations) {
        addDuplicateIssues(
          map.relations,
          ctx,
          [...path, "relations"],
          `Supporting relationships in map "${map.title}"`,
        );
        map.relations.forEach((relationId, relationIndex) => {
          const relation = readableRelationsById.get(relationId);
          if (!relation) {
            ctx.addIssue({
              code: "custom",
              message: `Map "${map.id}" references unknown or delivery-only relationship "${relationId}".`,
              path: [...path, "relations", relationIndex],
            });
            return;
          }
          if (pathRelationIds.has(relationId)) {
            ctx.addIssue({
              code: "custom",
              message: `Supporting relationship "${relationId}" is already part of a path.`,
              path: [...path, "relations", relationIndex],
            });
          }
          if (!pathEntityKeys.has(relation.from) || !pathEntityKeys.has(relation.to)) {
            ctx.addIssue({
              code: "custom",
              message: `Supporting relationship "${relationId}" must connect entities already placed by a path.`,
              path: [...path, "relations", relationIndex],
            });
          }
        });
      }

      if (map.regions) {
        addDuplicateIssues(
          map.regions.map((region) => region.id),
          ctx,
          [...path, "regions"],
          `Regions in map "${map.title}"`,
        );
        addDuplicateIssues(
          map.regions.flatMap((region) => region.entities),
          ctx,
          [...path, "regions"],
          `Region members in map "${map.title}"`,
        );
        map.regions.forEach((region, regionIndex) => {
          region.entities.forEach((reference, referenceIndex) => {
            addEntityReferenceIssue(reference, entities, ctx, [
              ...path,
              "regions",
              regionIndex,
              "entities",
              referenceIndex,
            ]);
            if (pathEntityKeys.has(reference)) return;
            ctx.addIssue({
              code: "custom",
              message: `Region "${region.id}" can contain only entities placed by a path.`,
              path: [...path, "regions", regionIndex, "entities", referenceIndex],
            });
          });
        });
      }

      const cycle = relationCycle(pathEntityKeys, pathRelations);
      if (cycle) {
        ctx.addIssue({
          code: "custom",
          message: `Paths in map "${map.id}" contain a cycle: ${cycle.join(" -> ")}.`,
          path: [...path, "paths"],
        });
      }
      return;
    }

    if (map.roots) {
      addDuplicateIssues(map.roots, ctx, [...path, "roots"], `Roots in map "${map.title}"`);
      map.roots.forEach((reference, referenceIndex) => {
        addEntityReferenceIssue(reference, entities, ctx, [...path, "roots", referenceIndex]);
      });
    }
    if (map.relations) {
      addDuplicateIssues(
        map.relations,
        ctx,
        [...path, "relations"],
        `Relationships in map "${map.title}"`,
      );
      map.relations.forEach((relationId, relationIndex) => {
        if (readableRelationIds.has(relationId)) return;
        ctx.addIssue({
          code: "custom",
          message: `Map "${map.id}" references unknown or delivery-only relationship "${relationId}".`,
          path: [...path, "relations", relationIndex],
        });
      });
    }
    if (map.kinds) {
      addDuplicateIssues(
        map.kinds,
        ctx,
        [...path, "kinds"],
        `Relationship kinds in map "${map.title}"`,
      );
    }
  });
}

/** Map excludes delivery-only links so architecture and implementation remain separate lenses. */
export function relationshipMapRelations(definition: IntentDefinition): EffectiveRelation[] {
  return relationshipMapRelationsFrom(definition, buildIntentIndex(definition.sections));
}

function relationshipMapRelationsFrom(
  definition: IntentDefinition,
  index: IntentIndex,
): EffectiveRelation[] {
  const authored = authoredRelations(definition, index).map(({ relation }) => relation);
  const workIds = new Set(
    index.sequences.flatMap((section) => workItems(section).map((item) => item.id)),
  );
  const candidateIds = new Set(
    relationshipMapCandidates(authored, workIds).map((relation) => relation.id),
  );
  return effectiveRelationsFrom(definition, index).filter(({ relation }) =>
    candidateIds.has(relation.id),
  );
}

/**
 * Project one authored graph reading. Explicit relationship order wins; roots
 * traverse outward so active decision relationships join the same reading.
 */
export function intentMapRelations(
  definition: IntentDefinition,
  map: MapSection,
): EffectiveRelation[] {
  return projectIntentMap(definition, buildIntentIndex(definition.sections), map).relations;
}

type IntentMapProjection = {
  relations: EffectiveRelation[];
  paths: ProjectedMapPathRelations[];
};

function projectIntentMap(
  definition: IntentDefinition,
  index: IntentIndex,
  map: MapSection,
): IntentMapProjection {
  const kinds = map.layout === "paths" || !map.kinds ? undefined : new Set(map.kinds);
  const available = relationshipMapRelationsFrom(definition, index).filter(
    ({ relation }) => !kinds || (relation.kind !== "implemented-by" && kinds.has(relation.kind)),
  );
  const availableById = new Map(available.map((effective) => [effective.relation.id, effective]));
  if (map.layout === "paths") {
    const paths = projectedMapPaths(map, available);
    const pathRelations = uniqueEffectiveRelations(paths.flatMap((path) => path.relations));
    const pathEntityKeys = new Set(
      pathRelations.flatMap(({ relation }) => [relation.from, relation.to]),
    );
    const supporting = (map.relations ?? []).flatMap((relationId) => {
      const effective = availableById.get(relationId);
      if (
        !effective ||
        !pathEntityKeys.has(effective.relation.from) ||
        !pathEntityKeys.has(effective.relation.to)
      ) {
        return [];
      }
      return [effective];
    });
    return {
      relations: uniqueEffectiveRelations([...pathRelations, ...supporting]),
      paths,
    };
  }

  const ordered = map.relations
    ? map.relations.flatMap((relationId) => {
        const effective = availableById.get(relationId);
        return effective ? [effective] : [];
      })
    : available;
  if (!map.roots) return { relations: ordered, paths: [] };

  const orderedById = new Map(ordered.map((effective) => [effective.relation.id, effective]));
  return {
    relations: projectOutwardRelations(
      map.roots,
      ordered.map(({ relation }) => relation),
    ).flatMap((relation) => {
      const effective = orderedById.get(relation.id);
      return effective ? [effective] : [];
    }),
    paths: [],
  };
}

type ProjectedMapPathRelations = {
  path: IntentMapPath;
  relations: EffectiveRelation[];
};

function projectedMapPaths(
  map: Extract<MapSection, { layout: "paths" }>,
  available: readonly EffectiveRelation[],
): ProjectedMapPathRelations[] {
  const availableById = new Map(available.map((effective) => [effective.relation.id, effective]));
  return map.paths.flatMap((path) => {
    const candidates = path.relations.flatMap((relationId) => {
      const effective = availableById.get(relationId);
      return effective ? [effective] : [];
    });
    const candidatesById = new Map(
      candidates.map((effective) => [effective.relation.id, effective]),
    );
    const relations = projectOutwardRelations(
      [path.root],
      candidates.map(({ relation }) => relation),
    ).flatMap((relation) => {
      const effective = candidatesById.get(relation.id);
      return effective ? [effective] : [];
    });
    return relations.length > 0 ? [{ path, relations }] : [];
  });
}

function uniqueEffectiveRelations(relations: readonly EffectiveRelation[]): EffectiveRelation[] {
  const seen = new Set<string>();
  return relations.filter(({ relation }) => {
    if (seen.has(relation.id)) return false;
    seen.add(relation.id);
    return true;
  });
}

/**
 * Arrange a task-authored relationship reading into outward stages while keeping
 * each entity as one stable node. Disconnected components and cycles remain
 * readable in authored discovery order instead of duplicating endpoint cards.
 */
export function intentMapGraph(definition: IntentDefinition, map: MapSection): IntentMapGraph {
  const index = buildIntentIndex(definition.sections);
  const projection = projectIntentMap(definition, index, map);
  const relations = projection.relations;
  const entities = new Map(intentEntitiesFrom(index).map((entity) => [entity.id, entity]));
  const nodeOrder: string[] = [];
  const nodeKeys = new Set<string>();
  const incoming = new Map<string, EffectiveRelation[]>();
  const outgoing = new Map<string, EffectiveRelation[]>();

  function appendNode(key: string) {
    if (nodeKeys.has(key) || !entities.has(key)) return;
    nodeKeys.add(key);
    nodeOrder.push(key);
  }

  for (const effective of relations) {
    const { from, to } = effective.relation;
    appendNode(from);
    appendNode(to);
    outgoing.set(from, [...(outgoing.get(from) ?? []), effective]);
    incoming.set(to, [...(incoming.get(to) ?? []), effective]);
  }

  const projectedPaths = projection.paths;
  const stageByKey =
    map.layout === "paths"
      ? mapPathStages(
          nodeOrder,
          uniqueEffectiveRelations(projectedPaths.flatMap((path) => path.relations)),
        )
      : outwardMapStages(map, nodeOrder, nodeKeys, incoming, outgoing);

  const stages: IntentMapGraphNode[][] = [];
  for (const key of nodeOrder) {
    const entity = entities.get(key);
    if (!entity) continue;
    const stage = stageByKey.get(key) ?? 0;
    const nodes = stages[stage] ?? [];
    nodes.push({
      entity,
      incoming: incoming.get(key) ?? [],
      outgoing: outgoing.get(key) ?? [],
    });
    stages[stage] = nodes;
  }
  const compactStages = stages.filter(Boolean);
  const nodesByKey = new Map(compactStages.flat().map((node) => [node.entity.id, node]));
  const paths = projectedPaths.map(({ path, relations: pathRelations }) => {
    const pathNodeKeys = new Set(
      pathRelations.flatMap(({ relation }) => [relation.from, relation.to]),
    );
    return {
      id: path.id,
      title: path.title,
      purpose: path.purpose,
      root: path.root,
      relations: pathRelations,
      nodes: compactStages.flat().filter((node) => pathNodeKeys.has(node.entity.id)),
    };
  });
  const regions =
    map.layout === "paths"
      ? (map.regions ?? []).flatMap((region) => {
          const nodes = region.entities.flatMap((reference) => {
            const node = nodesByKey.get(reference);
            return node ? [node] : [];
          });
          return nodes.length > 0 ? [{ id: region.id, title: region.title, nodes }] : [];
        })
      : [];
  return { relations, stages: compactStages, paths, regions };
}

function outwardMapStages(
  map: Extract<MapSection, { layout: "flow" | "network" }>,
  nodeOrder: readonly string[],
  nodeKeys: ReadonlySet<string>,
  incoming: ReadonlyMap<string, EffectiveRelation[]>,
  outgoing: ReadonlyMap<string, EffectiveRelation[]>,
): Map<string, number> {
  const authoredRoots = map.roots?.filter((entityId) => nodeKeys.has(entityId)) ?? [];
  const roots = [
    ...authoredRoots,
    ...nodeOrder.filter((key) => !authoredRoots.includes(key) && !incoming.has(key)),
  ];
  const stageByKey = new Map(roots.map((root) => [root, 0]));

  function placeQueue(queue: string[]) {
    for (let index = 0; index < queue.length; index += 1) {
      const source = queue[index]!;
      const nextStage = (stageByKey.get(source) ?? 0) + 1;
      for (const effective of outgoing.get(source) ?? []) {
        const target = effective.relation.to;
        if (stageByKey.has(target)) continue;
        stageByKey.set(target, nextStage);
        queue.push(target);
      }
    }
  }

  placeQueue([...roots]);
  for (const key of nodeOrder) {
    if (stageByKey.has(key)) continue;
    stageByKey.set(key, 0);
    placeQueue([key]);
  }
  return stageByKey;
}

function mapPathStages(
  nodeOrder: readonly string[],
  relations: readonly EffectiveRelation[],
): Map<string, number> {
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, EffectiveRelation[]>();
  for (const key of nodeOrder) incomingCount.set(key, 0);
  for (const effective of relations) {
    const { from, to } = effective.relation;
    outgoing.set(from, [...(outgoing.get(from) ?? []), effective]);
    incomingCount.set(to, (incomingCount.get(to) ?? 0) + 1);
  }

  const queue = nodeOrder.filter((key) => (incomingCount.get(key) ?? 0) === 0);
  const stageByKey = new Map(queue.map((key) => [key, 0]));
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index]!;
    for (const effective of outgoing.get(source) ?? []) {
      const target = effective.relation.to;
      stageByKey.set(
        target,
        Math.max(stageByKey.get(target) ?? 0, (stageByKey.get(source) ?? 0) + 1),
      );
      const remaining = (incomingCount.get(target) ?? 1) - 1;
      incomingCount.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }

  for (const key of nodeOrder) {
    if (!stageByKey.has(key)) stageByKey.set(key, 0);
  }
  return stageByKey;
}
