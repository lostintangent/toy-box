import { decisionPathIn, type IntentIndex } from "./read";
import type { IntentDefinitionBase, IntentEntityId, IntentRelation } from "./schema";

/**
 * The relation algebra shared by validation and every projection: how an entity
 * is identified, which relationships an author wrote and where, and the three
 * traversals (outward reachability, cycle detection, dependency layering) that
 * both semantic rules and reader-facing readings depend on.
 */

/** One authored relationship with its owner: the root document or a decision option. */
export type AuthoredRelation = {
  relation: IntentRelation;
  root: boolean;
  path: PropertyKey[];
};

export function authoredRelations(
  definition: IntentDefinitionBase,
  index: IntentIndex,
): AuthoredRelation[] {
  return [
    ...definition.relations.map((relation, relationIndex) => ({
      relation,
      root: true,
      path: ["relations", relationIndex],
    })),
    ...index.decisions.flatMap((item) => {
      const decisionPath = decisionPathIn(index, item);
      return item.options.flatMap((option, optionIndex) =>
        option.relations.map((relation, relationIndex) => ({
          relation,
          root: false,
          path: [...decisionPath, "options", optionIndex, "relations", relationIndex],
        })),
      );
    }),
  ];
}

/** Relationship maps read architecture, so delivery-only links never appear in one. */
export function relationshipMapCandidates(
  relations: readonly IntentRelation[],
  workIds: ReadonlySet<string>,
): IntentRelation[] {
  return relations.filter(
    (relation) =>
      relation.kind !== "implemented-by" &&
      !(relation.kind === "depends-on" && workIds.has(relation.from) && workIds.has(relation.to)),
  );
}

/** Relationships reachable outward from the given roots, in discovery order. */
export function projectOutwardRelations(
  roots: readonly IntentEntityId[],
  relations: readonly IntentRelation[],
): IntentRelation[] {
  const outgoing = new Map<string, IntentRelation[]>();
  for (const relation of relations) {
    outgoing.set(relation.from, [...(outgoing.get(relation.from) ?? []), relation]);
  }

  const queue = [...roots];
  const visitedEntities = new Set(queue);
  const visitedRelations = new Set<string>();
  const projected: IntentRelation[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    for (const relation of outgoing.get(queue[index]!) ?? []) {
      if (visitedRelations.has(relation.id)) continue;
      visitedRelations.add(relation.id);
      projected.push(relation);
      const target = relation.to;
      if (visitedEntities.has(target)) continue;
      visitedEntities.add(target);
      queue.push(target);
    }
  }
  return projected;
}

export function relationCycle(
  entityIds: ReadonlySet<string>,
  relations: readonly IntentRelation[],
): string[] | undefined {
  const outgoing = new Map<string, string[]>();
  for (const entityId of entityIds) outgoing.set(entityId, []);
  for (const relation of relations) {
    outgoing.get(relation.from)?.push(relation.to);
  }

  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];

  function visit(key: string): string[] | undefined {
    if (active.has(key)) {
      const start = path.indexOf(key);
      return [...path.slice(start), key];
    }
    if (visited.has(key)) return;
    active.add(key);
    path.push(key);
    for (const target of outgoing.get(key) ?? []) {
      const cycle = visit(target);
      if (cycle) return cycle;
    }
    path.pop();
    active.delete(key);
    visited.add(key);
  }

  for (const entityId of entityIds) {
    const cycle = visit(entityId);
    if (cycle) return cycle;
  }
}

/** Layer values into phases where a value follows everything it depends on. */
export function dependencyPhases<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  dependencies: readonly Pick<IntentRelation, "from" | "to">[],
): { phases: T[][]; cyclic: T[] } {
  const valueKeys = new Set(values.map(keyOf));
  const relevant = dependencies.filter(
    (relation) => valueKeys.has(relation.from) && valueKeys.has(relation.to),
  );
  const remaining = new Set(valueKeys);
  const phases: T[][] = [];

  while (remaining.size > 0) {
    const ready = values.filter((value) => {
      const key = keyOf(value);
      return (
        remaining.has(key) &&
        relevant
          .filter((relation) => relation.from === key)
          .every((relation) => !remaining.has(relation.to))
      );
    });
    if (ready.length === 0) break;
    phases.push(ready);
    for (const value of ready) remaining.delete(keyOf(value));
  }

  return {
    phases,
    cyclic: values.filter((value) => remaining.has(keyOf(value))),
  };
}
