import { describe, expect, test } from "bun:test";
import { createIdFactory, type JsonNode } from "./model";
import { parseDocument } from "./codec";
import { declaredId, indexEntities, isIdentityKey, resolveReference } from "./references";

function tree(source: string): JsonNode {
  const result = parseDocument(source, createIdFactory());
  if (!result.ok) throw new Error("fixture must parse");
  return result.root;
}

function object(node: JsonNode) {
  if (node.kind !== "object") throw new Error("expected an object");
  return node;
}

function array(node: JsonNode) {
  if (node.kind !== "array") throw new Error("expected an array");
  return node;
}

describe("references", () => {
  test("recognizes identity keys, including a bare id", () => {
    expect(["$id", "@id", "id"].every(isIdentityKey)).toBe(true);
    expect(isIdentityKey("$ref")).toBe(false);
    expect(isIdentityKey("name")).toBe(false);
  });

  test("indexes each declared id to its node and the containers above it", () => {
    const root = tree('{"group":{"users":[{"id":"u1"},{"$id":"u2"}]}}');
    const group = object(root).members[0].node;
    const users = array(object(group).members[0].node);
    const u2 = users.items[1];

    const located = indexEntities(root).get("u2");

    expect(located?.node.id).toBe(u2.id);
    expect(located?.ancestorIds).toEqual([root.id, group.id, users.id]);
  });

  test("resolves any string that matches a declared id, whatever its key", () => {
    const root = tree('{"users":[{"id":"u1"}],"author":"u1","tags":["u1"]}');
    const u1 = array(object(root).members[0].node).items[0];
    const entities = indexEntities(root);

    // An ordinary key whose value is a known id links to the declaring object...
    expect(resolveReference("author", "u1", entities)?.node.id).toBe(u1.id);
    // ...as does a bare array item, which has no key at all.
    expect(resolveReference(null, "u1", entities)?.node.id).toBe(u1.id);
  });

  test("never links a declaration, an unknown value, or a non-string", () => {
    const entities = indexEntities(tree('{"id":"u1"}'));

    expect(resolveReference("id", "u1", entities)).toBeNull(); // the declaration itself
    expect(resolveReference("ref", "nope", entities)).toBeNull(); // unknown id
    expect(resolveReference("ref", 42, entities)).toBeNull(); // not a string
  });

  test("ignores ids too short to be distinctive", () => {
    const entities = indexEntities(tree('{"id":"1"}'));

    expect(entities.size).toBe(0);
    expect(resolveReference("ref", "1", entities)).toBeNull();
  });

  test("reads the id an object declares, for the collapsed summary", () => {
    expect(declaredId(tree('{"id":"user-42","name":"Ann"}'))).toBe("user-42");
    expect(declaredId(tree('{"name":"Ann"}'))).toBeNull(); // no identity key
    expect(declaredId(tree('{"id":"x"}'))).toBeNull(); // too short to be distinctive
    expect(declaredId(tree("[1,2]"))).toBeNull(); // arrays have no id
  });
});
