import { describe, expect, test } from "bun:test";
import { parseAppState, parseAppStateDefinition } from "./state";

const schema = {
  $defs: {
    item: {
      type: "object" as const,
      properties: {
        id: { type: "string" as const },
        done: { type: "boolean" as const },
      },
      required: ["id", "done"],
      additionalProperties: false,
    },
  },
  type: "object" as const,
  properties: {
    title: { type: "string" as const },
    items: { type: "array" as const, items: { $ref: "#/$defs/item" } },
  },
  required: ["title", "items"],
  additionalProperties: false,
};

describe("app state schema", () => {
  test("validates one definition contract and its values", () => {
    const state = parseAppStateDefinition({
      schema,
      default: { title: "Today", items: [] },
    });

    expect(
      parseAppState(state.schema, { title: "Today", items: [{ id: "one", done: false }] }),
    ).toEqual({ title: "Today", items: [{ id: "one", done: false }] });
    expect(() => parseAppState(state.schema, { title: "Today", items: [{ id: 1 }] })).toThrow();
  });

  test("rejects a default that does not satisfy its schema", () => {
    expect(() =>
      parseAppStateDefinition({ schema, default: { title: "Missing items" } }),
    ).toThrow();
  });

  test("rejects schemas that Zod cannot compile", () => {
    expect(() => parseAppStateDefinition({ schema: { type: "wat" }, default: null })).toThrow(
      "Unsupported type",
    );
    expect(() =>
      parseAppStateDefinition({ schema: { $ref: "#/$defs/missing" }, default: null }),
    ).toThrow();
  });

  test("accepts the boolean schemas supported by Zod", () => {
    expect(parseAppStateDefinition({ schema: true, default: { ready: true } })).toEqual({
      schema: true,
      default: { ready: true },
    });
    expect(() => parseAppStateDefinition({ schema: false, default: null })).toThrow();
  });
});
