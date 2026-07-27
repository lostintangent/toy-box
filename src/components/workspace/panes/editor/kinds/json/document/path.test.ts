import { describe, expect, test } from "bun:test";
import { childPointer, ROOT_POINTER } from "./path";

describe("JSON pointer", () => {
  test("addresses the root as the empty pointer", () => {
    expect(ROOT_POINTER).toBe("");
  });

  test("extends by object key and array index", () => {
    expect(childPointer(ROOT_POINTER, "user")).toBe("/user");
    expect(childPointer("/user", "roles")).toBe("/user/roles");
    expect(childPointer("/user/roles", 0)).toBe("/user/roles/0");
  });

  test("escapes reserved characters in keys per RFC 6901", () => {
    expect(childPointer(ROOT_POINTER, "a/b")).toBe("/a~1b");
    expect(childPointer(ROOT_POINTER, "a~b")).toBe("/a~0b");
  });
});
