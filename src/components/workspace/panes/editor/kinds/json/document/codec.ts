// The document codec: the boundary between file text and the node tree. Parsing
// assigns fresh identities in document pre-order so the tree is deterministic for
// a given id factory. Serialization is a hand-written pretty-printer rather than
// `JSON.stringify` of a rebuilt object, so exact member order is preserved even
// for numeric-like keys and the on-disk shape stays stable across round-trips.

import type { JsonValue } from "@/types";
import { arrayNode, objectNode, scalarNode, type IdFactory, type JsonNode } from "./model";

export type ParseResult = { ok: true; root: JsonNode } | { ok: false; error: string };

const INDENT = "  ";

/** Parse file text into a node tree, defaulting empty files to an empty object. */
export function parseDocument(source: string, newId: IdFactory): ParseResult {
  if (source.trim() === "") return { ok: true, root: objectNode(newId()) };

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON." };
  }
  return { ok: true, root: fromJsonValue(value as JsonValue, newId) };
}

function fromJsonValue(value: JsonValue, newId: IdFactory): JsonNode {
  if (Array.isArray(value)) {
    return arrayNode(
      newId(),
      value.map((item) => fromJsonValue(item, newId)),
    );
  }
  if (value !== null && typeof value === "object") {
    return objectNode(
      newId(),
      Object.entries(value).map(([key, child]) => ({ key, node: fromJsonValue(child, newId) })),
    );
  }
  return scalarNode(newId(), value);
}

/** Serialize the tree to pretty-printed JSON with a trailing newline. */
export function serializeDocument(root: JsonNode): string {
  return `${writeNode(root, 0)}\n`;
}

function writeNode(node: JsonNode, depth: number): string {
  switch (node.kind) {
    case "scalar":
      return JSON.stringify(node.value);
    case "array": {
      if (node.items.length === 0) return "[]";
      const pad = INDENT.repeat(depth + 1);
      const body = node.items.map((item) => pad + writeNode(item, depth + 1)).join(",\n");
      return `[\n${body}\n${INDENT.repeat(depth)}]`;
    }
    case "object": {
      if (node.members.length === 0) return "{}";
      const pad = INDENT.repeat(depth + 1);
      const body = node.members
        .map(
          (member) => `${pad}${JSON.stringify(member.key)}: ${writeNode(member.node, depth + 1)}`,
        )
        .join(",\n");
      return `{\n${body}\n${INDENT.repeat(depth)}}`;
    }
  }
}
