import { describe, expect, test } from "bun:test";
import { createIdFactory, scalarNode, type JsonNode } from "./model";
import { parseDocument, serializeDocument } from "./codec";
import {
  appendItem,
  insertMember,
  removeNode,
  renameMemberKey,
  reorderChildren,
  setValue,
} from "./operations";

// A shared fixture: an object with a leaf and an array, so operations can be
// exercised against both container shapes and structural sharing verified.
function fixture(): JsonNode {
  const result = parseDocument('{"a":1,"b":[10,20]}', createIdFactory());
  if (!result.ok) throw new Error("fixture must parse");
  return result.root;
}

/** The plain JSON value a tree serializes to, for order-preserving assertions. */
function plain(node: JsonNode): unknown {
  return JSON.parse(serializeDocument(node));
}

function object(node: JsonNode) {
  if (node.kind !== "object") throw new Error("expected an object node");
  return node;
}

function array(node: JsonNode) {
  if (node.kind !== "array") throw new Error("expected an array node");
  return node;
}

describe("JSON document operations", () => {
  test("setValue replaces one leaf and shares untouched subtrees", () => {
    const root = fixture();
    const leafId = object(root).members[0].node.id;

    const next = setValue(root, leafId, "changed");

    expect(plain(next)).toEqual({ a: "changed", b: [10, 20] });
    expect(object(next).members[1]).toBe(object(root).members[1]);
  });

  test("setValue is a no-op when the value is unchanged", () => {
    const root = fixture();
    const leafId = object(root).members[0].node.id;

    expect(setValue(root, leafId, 1)).toBe(root);
  });

  test("insertMember appends to the addressed object", () => {
    const root = fixture();

    const next = insertMember(root, root.id, { key: "c", node: scalarNode("x", true) });

    expect(plain(next)).toEqual({ a: 1, b: [10, 20], c: true });
  });

  test("appendItem appends to the addressed array", () => {
    const root = fixture();
    const arrayId = object(root).members[1].node.id;

    const next = appendItem(root, arrayId, scalarNode("x", 30));

    expect(plain(next)).toEqual({ a: 1, b: [10, 20, 30] });
  });

  test("reorderChildren moves a sibling within its parent", () => {
    const root = fixture();
    const arrayId = object(root).members[1].node.id;

    expect(plain(reorderChildren(root, arrayId, 0, 1))).toEqual({ a: 1, b: [20, 10] });
  });

  test("reorderChildren is a no-op for equal or out-of-range indices", () => {
    const root = fixture();
    const arrayId = object(root).members[1].node.id;

    expect(reorderChildren(root, arrayId, 1, 1)).toBe(root);
    expect(reorderChildren(root, arrayId, 0, 5)).toBe(root);
  });

  test("removeNode drops a member and shares the rest", () => {
    const root = fixture();
    const leafId = object(root).members[0].node.id;

    expect(plain(removeNode(root, leafId))).toEqual({ b: [10, 20] });
  });

  test("removeNode drops an array item by identity", () => {
    const root = fixture();
    const firstItemId = array(object(root).members[1].node).items[0].id;

    expect(plain(removeNode(root, firstItemId))).toEqual({ a: 1, b: [20] });
  });

  test("removeNode cannot remove the document root or an unknown id", () => {
    const root = fixture();

    expect(removeNode(root, root.id)).toBe(root);
    expect(removeNode(root, "missing")).toBe(root);
  });

  test("renameMemberKey renames the owning member", () => {
    const root = fixture();
    const leafId = object(root).members[0].node.id;

    const next = renameMemberKey(root, leafId, "renamed");

    expect(next).not.toBeNull();
    expect(plain(next as JsonNode)).toEqual({ renamed: 1, b: [10, 20] });
  });

  test("renameMemberKey rejects a duplicate sibling key with null", () => {
    const root = fixture();
    const leafId = object(root).members[0].node.id;

    expect(renameMemberKey(root, leafId, "b")).toBeNull();
  });

  test("renameMemberKey keeps the same tree when the key is unchanged", () => {
    const root = fixture();
    const leafId = object(root).members[0].node.id;

    expect(renameMemberKey(root, leafId, "a")).toBe(root);
  });
});
