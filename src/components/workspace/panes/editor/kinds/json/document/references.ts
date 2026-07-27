// Plain JSON has no notion of identity or links, but a few conventions layer a graph
// on top. An object *declares* an identity with a key like `$id`, `@id`, or `id`; a
// value elsewhere *refers* to it simply by repeating that id. So rather than trusting
// a dedicated `$ref` key, we infer a reference from the data: any string equal to a
// declared id is a link to it. These are recognized shapes over the plain, three-kinded
// model — not new node kinds. Extend `IDENTITY_KEYS` to teach it more ways to declare.

import type { JsonNode, JsonScalar, NodeId } from "./model";

const IDENTITY_KEYS: ReadonlySet<string> = new Set(["$id", "@id", "id"]);

// An id this short (e.g. "1", "a") collides too readily with ordinary values to link
// on safely, so such ids are neither indexed nor resolved.
const MIN_ID_LENGTH = 2;

export function isIdentityKey(key: string): boolean {
  return IDENTITY_KEYS.has(key);
}

/** A declared entity: the node that carries the id, and the containers (root first)
 *  to expand to bring it into view. */
export type Entity = {
  readonly node: JsonNode;
  readonly ancestorIds: readonly NodeId[];
};

/** Every declared id mapped to its entity — the document's identity map, built once
 *  so resolving a reference is a lookup rather than a fresh walk per link. */
export type EntityIndex = ReadonlyMap<string, Entity>;

export function indexEntities(root: JsonNode): EntityIndex {
  const index = new Map<string, Entity>();
  const walk = (node: JsonNode, ancestorIds: readonly NodeId[]): void => {
    if (node.kind === "scalar") return;
    if (node.kind === "object") {
      const id = declaredId(node);
      // First declaration wins, so a stray duplicate can't hijack an existing target.
      if (id !== null && !index.has(id)) index.set(id, { node, ancestorIds });
    }
    const children =
      node.kind === "object" ? node.members.map((member) => member.node) : node.items;
    const within = [...ancestorIds, node.id];
    for (const child of children) walk(child, within);
  };
  walk(root, []);
  return index;
}

/** The entity a value points to, or null when it is not a reference: only a string
 *  matching a declared id counts, and never an id's own declaration. */
export function resolveReference(
  key: string | null,
  value: JsonScalar,
  entities: EntityIndex,
): Entity | null {
  if (typeof value !== "string") return null;
  if (key !== null && isIdentityKey(key)) return null;
  return entities.get(value) ?? null;
}

/** The id an object declares through its first identity-keyed string member, or null
 *  for a non-object or an object that declares none. */
export function declaredId(node: JsonNode): string | null {
  if (node.kind !== "object") return null;
  for (const member of node.members) {
    if (
      isIdentityKey(member.key) &&
      member.node.kind === "scalar" &&
      typeof member.node.value === "string" &&
      member.node.value.length >= MIN_ID_LENGTH
    ) {
      return member.node.value;
    }
  }
  return null;
}
