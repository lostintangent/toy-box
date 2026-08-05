import { describe, expect, test } from "bun:test";
import { BUILT_IN_APP_DEFINITIONS } from "@/apps/builtins";
import { parseAppState } from "@/lib/apps/stateSchema";

const appModule = "./app";
const { isSquadLeader } = (await import(appModule)) as {
  isSquadLeader(session: { title: string }): boolean;
};

const definition = BUILT_IN_APP_DEFINITIONS.find(({ id }) => id === "toybox-squad")!;

describe("Squad Board", () => {
  test("keeps its stateless manifest default valid", () => {
    expect(parseAppState(definition.state.schema, definition.state.default)).toEqual({});
  });

  test("discovers only sessions explicitly launched through the squad skill", () => {
    expect(isSquadLeader({ title: "/run-squad Build and review the change" })).toBe(true);
    expect(isSquadLeader({ title: "run-squad Build and review the change" })).toBe(true);
    expect(isSquadLeader({ title: "Factory Floor coordinator" })).toBe(false);
    expect(isSquadLeader({ title: "run-squad-dashboard" })).toBe(false);
  });
});
