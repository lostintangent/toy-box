import { mkdirSync, statfsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Arm, Experiment, Run, Step, System } from ".";
import { scratch } from "./arm";
import { isolate } from "./sandbox";

/** Runs every arm `runs` times, interleaved so a slow hour slows every arm alike, `parallel` at a
 *  time, writing each run's JSON as it ends. It stops starting runs on Ctrl-C, or when free disk
 *  falls below 400 MB per parallel run plus 2 GB. */
export async function runAll(experiment: Experiment, arms: Arm[], parallel: number, out: string) {
  script(experiment); // Throws before any run starts when `through` names no step.
  const interrupt = new AbortController();
  process.once("SIGINT", () => interrupt.abort());
  // Run folders sort by arm, so the first arm stays the baseline whenever they're scored.
  const queue = Array.from({ length: experiment.runs }, (_, n) =>
    arms.map((arm, index) => ({
      arm,
      id: `${String.fromCharCode(97 + index)}${n + 1}-${arm.name}`,
    })),
  ).flat();
  let short = false;
  const worker = async () => {
    for (let job = queue.shift(); job && !interrupt.signal.aborted; job = queue.shift()) {
      const { bavail, bsize } = statfsSync(scratch);
      if (bavail * bsize < parallel * 400e6 + 2e9) return void (short = true);
      console.log(`${job.id}: starting`);
      const run = await one(experiment, job.arm, join(out, job.id), interrupt.signal);
      console.log(`${run.id}: ${run.outcome}${run.reason ? ` (${run.reason})` : ""}`);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  if (short) throw new Error("Stopped early: free disk fell below --parallel × 400 MB + 2 GB");
}

/** One run, start to end. Whatever happens, it writes the run's JSON, ends its system once, and
 *  leaves no sandbox behind. */
export async function one(experiment: Experiment, arm: Arm, dir: string, interrupt: AbortSignal) {
  const { scenario } = experiment;
  mkdirSync(dir, { recursive: true });
  const started = Date.now();
  const run: Run = {
    id: basename(dir),
    arm: arm.name,
    spec: arm.spec,
    scenario: scenario.name,
    revision: scenario.revision,
    outcome: "completed",
    startedAt: iso(started),
    endedAt: "",
    steps: [],
  };
  const signal = AbortSignal.any([AbortSignal.timeout(scenario.cap * 60_000), interrupt]);
  const sandbox = await isolate(arm, scenario.fixture, signal, dir);
  let system: System<unknown> | string | undefined;
  try {
    system = await scenario.adapter.start(arm, sandbox, scenario.setup);
    if (typeof system === "string") Object.assign(run, { outcome: "invalid", reason: system });
    else await drive(system, script(experiment), run, started);
  } catch (error) {
    run.outcome = interrupt.aborted ? "interrupted" : signal.aborted ? "stalled" : "failed";
    if (run.outcome === "stalled")
      run.reason = `cap reached after ${run.steps.at(-1)?.id ?? "kickoff"}`;
    if (run.outcome === "failed") run.reason = String((error as Error).stack ?? error);
  } finally {
    const { evidence, invalid } = typeof system === "object" ? await system.end() : {};
    if (run.outcome === "completed" && invalid)
      Object.assign(run, { outcome: "invalid", reason: invalid });
    run.endedAt = iso(Date.now());
    await Bun.write(join(dir, "run.json"), JSON.stringify({ ...run, ...evidence }));
    // Asynchronous, so removing a large sandbox doesn't stall a parallel run.
    await rm(dirname(sandbox.home), { recursive: true, force: true });
  }
  return run;
}

/** Sends each step once the system rests and its trigger gives a reason, then ends the run at the
 *  rest after its last message. */
async function drive<State>(system: System<State>, script: Step<State>[], run: Run, start: number) {
  const minutes = (from: number) => (Date.now() - from) / 60_000;
  let last = start;
  for (const step of script) {
    let trigger: string | undefined;
    while (!trigger) {
      const state = await system.settle(30_000);
      if (state !== undefined)
        trigger = step.trigger({ minutes: minutes(start), since: minutes(last), state });
    }
    const at = await system.send(step.content);
    run.steps.push({ id: step.id, trigger, at });
    last = Date.parse(at);
  }
  while ((await system.settle(30_000)) === undefined);
}

/** The steps an experiment sends: through the one it names, none for "kickoff", or all of them. */
export function script({ scenario, through }: Experiment) {
  if (through === undefined) return scenario.script;
  const count =
    through === "kickoff" ? 0 : scenario.script.findIndex(({ id }) => id === through) + 1;
  if (through !== "kickoff" && !count)
    throw new Error(`${through} isn't a step of ${scenario.name}`);
  return scenario.script.slice(0, count);
}

const iso = (ms: number) => new Date(ms).toISOString();
