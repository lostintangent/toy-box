import { describe, expect, test } from "bun:test";
import { createIdFactory } from "./model";
import { parseDocument } from "./codec";
import { diffDocuments } from "./diff";

function tree(source: string) {
  const result = parseDocument(source, createIdFactory());
  if (!result.ok) throw new Error("fixture must parse");
  return result.root;
}

function diff(before: string, after: string) {
  return diffDocuments(tree(before), tree(after));
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
});
