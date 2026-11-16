import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Adapter, Arm, Experiment, Run, Sandbox, System } from ".";
import { one } from "./run";

const results = mkdtempSync(join(tmpdir(), "evals-run-test-"));
afterAll(() => rmSync(results, { recursive: true, force: true }));

const arm: Arm = {
  name: "fake",
  spec: "HEAD:fake/model",
  tree: "",
  provider: "fake",
  model: "model",
};

/** One run against a fake product whose state counts its rests. `make` overrides parts of the
 *  live system, or says why the arm can't run. */
async function attempt(
  make: (sandbox: Sandbox) => Partial<System<number>> | string = () => ({}),
  { cap = 1, interrupt = new AbortController().signal } = {},
) {
  const seen = { rests: 0, ends: 0, sandbox: undefined as Sandbox | undefined };
  const adapter: Adapter<null, number, Run> = {
    build: async () => {},
    async start(_arm, sandbox) {
      seen.sandbox = sandbox;
      const system = make(sandbox);
      if (typeof system === "string") return system;
      return {
        settle: async () => ++seen.rests,
        send: async () => new Date().toISOString(),
        ...system,
        end: async () => {
          seen.ends++;
          return system.end ? system.end() : { evidence: { kept: true } };
        },
      };
    },
    view: (run) => run,
  };
  const experiment: Experiment = {
    scenario: {
      name: "fake",
      revision: 1,
      adapter,
      cap,
      fixture: { "README.md": "A fixture.\n" },
      setup: null,
      script: [
        {
          id: "M1",
          content: "Hello",
          trigger: ({ state }) => (state >= 3 ? "third rest" : undefined),
        },
      ],
      scorecard: { criteria: [], measures: [] },
    },
    runs: 1,
    arms: {},
    predictions: [],
  };
  const dir = mkdtempSync(join(results, "a1-"));
  const run = await one(experiment, arm, dir, interrupt);
  const saved: Run = await Bun.file(join(dir, "run.json")).json();
  expect(saved.outcome).toBe(run.outcome);
  expect(existsSync(dirname(seen.sandbox!.home))).toBe(false);
  return { run, saved, seen };
}

/** A system that never rests, so only an abort ends its run. */
const resting = ({ signal }: Sandbox) => ({
  settle: () =>
    new Promise<number>((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason));
    }),
});

describe("one", () => {
  test("a step waits for its trigger, and a completed run keeps the system's evidence", async () => {
    const { run, saved, seen } = await attempt();
    expect(run.outcome).toBe("completed");
    expect(run.steps.map(({ id, trigger }) => [id, trigger])).toEqual([["M1", "third rest"]]);
    // Three rests before the step, and one after it to end the run.
    expect(seen.rests).toBe(4);
    expect(seen.ends).toBe(1);
    expect(saved.kept).toBe(true);
  });

  test("a run that reaches its cap is stalled, with how far it got", async () => {
    const { run, seen } = await attempt(resting, { cap: 0.005 });
    expect([run.outcome, run.reason]).toEqual(["stalled", "cap reached after kickoff"]);
    expect(seen.ends).toBe(1);
  });

  test("a run that throws is failed, with the error", async () => {
    const { run, seen } = await attempt(() => ({
      send: () => Promise.reject(new Error("send broke")),
    }));
    expect(run.outcome).toBe("failed");
    expect(run.reason).toContain("send broke");
    expect(seen.ends).toBe(1);
  });

  test("a run stopped by Ctrl-C is interrupted", async () => {
    const interrupt = AbortSignal.timeout(100);
    const { run, seen } = await attempt(resting, { interrupt });
    expect(run.outcome).toBe("interrupted");
    expect(seen.ends).toBe(1);
  });

  test("an arm that can't run as asked is invalid, with no system to end", async () => {
    const { run, seen } = await attempt(() => "no models offered");
    expect([run.outcome, run.reason]).toEqual(["invalid", "no models offered"]);
    expect(seen.ends).toBe(0);
  });

  test("a completed run that measured something else is invalid", async () => {
    const { run } = await attempt(() => ({
      end: async () => ({ evidence: {}, invalid: "another model answered" }),
    }));
    expect([run.outcome, run.reason]).toEqual(["invalid", "another model answered"]);
  });
});
