import type { NewNodeType } from "../store";

// The child types offered wherever a container can grow, shared by the inline
// "+ Add" row and the per-row actions menu. Scalars first, then containers.

export const SCALAR_NODE_TYPES: readonly { type: NewNodeType; label: string }[] = [
  { type: "string", label: "String" },
  { type: "number", label: "Number" },
  { type: "boolean", label: "Boolean" },
  { type: "null", label: "Null" },
];

export const CONTAINER_NODE_TYPES: readonly { type: NewNodeType; label: string }[] = [
  { type: "object", label: "Object" },
  { type: "array", label: "Array" },
];
