import { describe, expect, test } from "bun:test";
import type { Run, Scenario } from ".";
import { compare, score } from "./score";

/** A scenario whose one criterion, at step M1, passes when the run says so. */
const scenario: Scenario<null, null, Run> = {
  name: "fake",
  revision: 1,
  adapter: { build: async () => {}, start: async () => "unused", view: (run) => run },
  cap: 1,
  fixture: {},
  setup: null,
  script: [],
  scorecard: {
    criteria: [{ id: "K1", step: "M1", governs: "Kickoff", check: (run) => run.pass as boolean }],
    measures: [],
  },
};
const run = (arm: string, pass: boolean, fields: Partial<Run> = {}): Run => ({
  id: `${arm}-${Math.random()}`,
  arm,
  spec: `HEAD:fake/${arm}`,
  scenario: "fake",
  revision: 1,
  outcome: "completed",
  startedAt: "",
  endedAt: "",
  steps: [{ id: "M1", trigger: "first rest", at: "" }],
  pass,
  ...fields,
});
const passes = (arm: string, count: number) => [1, 2, 3].map((n) => run(arm, n <= count));

describe("score", () => {
  test("only a completed run is scored, and a criterion whose step was never sent doesn't apply", () => {
    expect(score(run("base", true), scenario).verdicts).toEqual({ K1: true });
    expect(score(run("base", true, { steps: [] }), scenario).verdicts).toEqual({ K1: null });
    expect(score(run("base", true, { outcome: "stalled" }), scenario).verdicts).toEqual({});
  });
});

describe("compare", () => {
  const flags = (runs: Run[]) => compare(runs, scenario).flags;

  test("flags a candidate that trails the baseline by 2 passes, but not by 1", () => {
    expect(flags([...passes("base", 3), ...passes("next", 1)])).toEqual([
      { arm: "next", criterion: "K1" },
    ]);
    expect(flags([...passes("base", 3), ...passes("next", 2)])).toEqual([]);
  });

  test("the first run's arm is the baseline", () => {
    expect(flags([...passes("next", 1), ...passes("base", 3)])).toEqual([]);
  });

  test("refuses runs it can't pool", () => {
    const base = passes("base", 3);
    expect(() => flags([...base, run("base", true, { spec: "HEAD:fake/other" })])).toThrow(
      "ran HEAD:fake/base and HEAD:fake/other",
    );
    expect(() => flags([...base, run("next", true, { revision: 2 })])).toThrow("revision 2");
    expect(() => flags([...base, run("next", true, { steps: [] })])).toThrow("different steps");
  });
});
