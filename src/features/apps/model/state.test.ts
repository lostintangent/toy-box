import { describe, expect, test } from "bun:test";
import { parseAppState, appStateDefinitionSchema } from "./state";

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
    const state = appStateDefinitionSchema.parse({
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
      appStateDefinitionSchema.parse({ schema, default: { title: "Missing items" } }),
    ).toThrow();
  });

  test("rejects schemas that Zod cannot compile", () => {
    expect(() =>
      appStateDefinitionSchema.parse({ schema: { type: "wat" }, default: null }),
    ).toThrow("Unsupported type");
    expect(() =>
      appStateDefinitionSchema.parse({ schema: { $ref: "#/$defs/missing" }, default: null }),
    ).toThrow();
  });

  test("accepts the boolean schemas supported by Zod", () => {
    expect(appStateDefinitionSchema.parse({ schema: true, default: { ready: true } })).toEqual({
      schema: true,
      default: { ready: true },
    });
    expect(() => appStateDefinitionSchema.parse({ schema: false, default: null })).toThrow();
  });
});
