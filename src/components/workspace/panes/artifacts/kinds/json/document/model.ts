// The JSON document's ontology: a tree of identified nodes over the three shapes
// JSON allows. A container is either an object of keyed members or an array of
// ordered items; every other JSON value is a scalar leaf whose JavaScript value
// carries its own type. Identity (`NodeId`) is stable across edits so the
// editor can address a node for editing or reordering without tracking its path.

export type NodeId = string;

export type JsonScalar = string | number | boolean | null;

export type JsonNode =
  | { readonly id: NodeId; readonly kind: "object"; readonly members: readonly Member[] }
  | { readonly id: NodeId; readonly kind: "array"; readonly items: readonly JsonNode[] }
  | { readonly id: NodeId; readonly kind: "scalar"; readonly value: JsonScalar };

/** The only keyed edge in the tree: one entry of an object. */
export type Member = { readonly key: string; readonly node: JsonNode };

/** The type a scalar leaf carries, derived from its value rather than stored. */
export type ScalarType = "string" | "number" | "boolean" | "null";

/** Allocates unique, monotonically increasing node identities. */
export type IdFactory = () => NodeId;

export function createIdFactory(start = 0): IdFactory {
  let next = start;
  return () => `n${next++}`;
}

export function objectNode(id: NodeId, members: readonly Member[] = []): JsonNode {
  return { id, kind: "object", members };
}

export function arrayNode(id: NodeId, items: readonly JsonNode[] = []): JsonNode {
  return { id, kind: "array", items };
}

export function scalarNode(id: NodeId, value: JsonScalar): JsonNode {
  return { id, kind: "scalar", value };
}

/** How many direct children a node holds; leaves hold none. */
export function childCount(node: JsonNode): number {
  switch (node.kind) {
    case "object":
      return node.members.length;
    case "array":
      return node.items.length;
    case "scalar":
      return 0;
  }
}

export function scalarTypeOf(value: JsonScalar): ScalarType {
  if (value === null) return "null";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

/** Locate a node anywhere in the tree by identity; null when absent. */
export function findNode(root: JsonNode, id: NodeId): JsonNode | null {
  if (root.id === id) return root;
  switch (root.kind) {
    case "object":
      for (const member of root.members) {
        const found = findNode(member.node, id);
        if (found) return found;
      }
      return null;
    case "array":
      for (const item of root.items) {
        const found = findNode(item, id);
        if (found) return found;
      }
      return null;
    case "scalar":
      return null;
  }
}
