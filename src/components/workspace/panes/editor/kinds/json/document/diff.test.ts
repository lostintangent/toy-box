import { describe, expect, test } from "bun:test";
import { createIdFactory } from "./model";
import { parseDocument } from "./codec";
import { reconcile } from "./diff";

function tree(source: string) {
  const result = parseDocument(source, createIdFactory());
  if (!result.ok) throw new Error("fixture must parse");
  return result.root;
}

function diff(before: string, after: string) {
  return reconcile(tree(before), tree(after)).diff;
}

describe("document diff", () => {
  test("marks an added member and leaves siblings untouched", () => {
    const changes = diff('{"a":1}', '{"a":1,"b":2}');

    expect(changes.get("/b")).toBe("added");
    expect(changes.has("/a")).toBe(false);
  });

  test("marks a changed scalar at its own location", () => {
    expect(diff('{"a":1}', '{"a":2}').get("/a")).toBe("changed");
  });

  test("marks every location inside a newly added subtree", () => {
    const changes = diff("{}", '{"user":{"name":"x"}}');

    expect(changes.get("/user")).toBe("added");
    expect(changes.get("/user/name")).toBe("added");
  });

  test("treats a scalar replaced by a container as a change plus added contents", () => {
    const changes = diff('{"a":1}', '{"a":{"b":2}}');

    expect(changes.get("/a")).toBe("changed");
    expect(changes.get("/a/b")).toBe("added");
  });

  test("reports no changes for an identical document", () => {
    expect(diff('{"a":[1,2],"b":true}', '{"a":[1,2],"b":true}').size).toBe(0);
  });

  test("does not mark a same-kind container whose members are unchanged", () => {
    const changes = diff('{"a":{"b":1}}', '{"a":{"b":1},"c":9}');

    expect(changes.has("/a")).toBe(false);
    expect(changes.get("/c")).toBe("added");
  });

  test("reconcile reuses the id and reference of an unchanged subtree in one pass", () => {
    // A shared factory so the reparse mints fresh ids, as the editor's store does.
    const ids = createIdFactory();
    const object = (source: string) => {
      const result = parseDocument(source, ids);
      if (!result.ok || result.root.kind !== "object") throw new Error("fixture must be an object");
      return result.root;
    };
    const before = object('{"a":{"b":1},"c":2}');
    const after = object('{"a":{"b":1},"c":3}');

    const { root, diff: changes } = reconcile(before, after);
    if (root.kind !== "object") throw new Error("expected an object");

    // /a was untouched → the whole subtree (its id included) is carried over by reference.
    expect(root.members[0].node).toBe(before.members[0].node);
    // /c changed value → a fresh node that keeps its id but takes the new value.
    expect(changes.get("/c")).toBe("changed");
    expect(root.members[1].node.id).toBe(before.members[1].node.id);
    expect(root.members[1].node).toEqual({
      id: before.members[1].node.id,
      kind: "scalar",
      value: 3,
    });
  });
});
