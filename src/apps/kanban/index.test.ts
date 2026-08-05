import { describe, expect, test } from "bun:test";
import { BUILT_IN_APP_DEFINITIONS } from "@/apps/builtins";
import { parseAppState } from "@/lib/apps/stateSchema";

const definition = BUILT_IN_APP_DEFINITIONS.find(({ id }) => id === "toybox-kanban")!;

describe("Kanban Board", () => {
  test("uses the canonical built-in title", () => {
    expect(definition.title).toBe("Kanban Board");
  });

  test("keeps the manifest default valid", () => {
    expect(parseAppState(definition.state.schema, definition.state.default)).toEqual(
      definition.state.default,
    );
  });

  test("rejects malformed durable state", () => {
    expect(() =>
      parseAppState(definition.state.schema, {
        columns: [{ id: "todo", title: "Todo" }],
        cards: [],
      }),
    ).toThrow();
  });
});
