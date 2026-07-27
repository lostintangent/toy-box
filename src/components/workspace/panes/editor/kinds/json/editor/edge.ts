import type { NodeId } from "../document";

// How a node attaches to its parent — the context a row needs that the node itself
// does not carry: its key (in an object), its index among `count` siblings, and its
// parent's id. The root attaches to nothing, which is also what tells a row menu the
// node can't be reordered or deleted.
export type Edge =
  | { kind: "root" }
  | { kind: "member"; parentId: NodeId; index: number; count: number; key: string }
  | { kind: "item"; parentId: NodeId; index: number; count: number };
