// A structural diff between two document trees, keyed by JSON Pointer so it stays
// stable across the re-parse that produces the incoming tree. It records where the
// agent added or changed a value; unchanged locations — and, for now, removals —
// are simply absent. Same-kind containers are never marked themselves; their
// members are diffed individually so a change lands on the leaf that moved.

import type { JsonNode } from "./model";
import { childPointer, ROOT_POINTER, type JsonPointer } from "./path";

export type ChangeKind = "added" | "changed";
export type DocumentDiff = ReadonlyMap<JsonPointer, ChangeKind>;

export function diffDocuments(before: JsonNode, after: JsonNode): DocumentDiff {
  const changes = new Map<JsonPointer, ChangeKind>();
  walk(after, ROOT_POINTER, indexByPointer(before), changes);
  return changes;
}

function walk(
  node: JsonNode,
  pointer: JsonPointer,
  before: Map<JsonPointer, JsonNode>,
  changes: Map<JsonPointer, ChangeKind>,
): void {
  const prior = before.get(pointer);
  if (prior === undefined) {
    markSubtree(node, pointer, changes);
    return;
  }
  if (differs(prior, node)) changes.set(pointer, "changed");
  forEachChild(node, (child, step) => walk(child, childPointer(pointer, step), before, changes));
}

function markSubtree(
  node: JsonNode,
  pointer: JsonPointer,
  changes: Map<JsonPointer, ChangeKind>,
): void {
  changes.set(pointer, "added");
  forEachChild(node, (child, step) => markSubtree(child, childPointer(pointer, step), changes));
}

/** A location differs when its own scalar value or its kind changed. */
function differs(before: JsonNode, after: JsonNode): boolean {
  if (before.kind !== after.kind) return true;
  return (
    before.kind === "scalar" && after.kind === "scalar" && !Object.is(before.value, after.value)
  );
}

function indexByPointer(root: JsonNode): Map<JsonPointer, JsonNode> {
  const map = new Map<JsonPointer, JsonNode>();
  const visit = (node: JsonNode, pointer: JsonPointer) => {
    map.set(pointer, node);
    forEachChild(node, (child, step) => visit(child, childPointer(pointer, step)));
  };
  visit(root, ROOT_POINTER);
  return map;
}

function forEachChild(
  node: JsonNode,
  visit: (child: JsonNode, step: string | number) => void,
): void {
  switch (node.kind) {
    case "object":
      node.members.forEach((member) => visit(member.node, member.key));
      return;
    case "array":
      node.items.forEach((item, index) => visit(item, index));
      return;
    case "scalar":
      return;
  }
}
