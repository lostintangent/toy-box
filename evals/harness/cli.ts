import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Experiment, Run } from ".";
import { prepare, repo } from "./arm";
import { runAll } from "./run";
import { compare, print } from "./score";

const usage = `Usage: bun eval <experiment.ts> [<results folder>…] [--parallel 1]
  With no results folders, runs the experiment into a new one, then scores it.
  With some, scores them again, pooled, with the experiment's scenario and their own predictions.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { parallel: { type: "string", default: "1" } },
});
const [file, ...folders] = positionals;
if (!file) {
  console.error(usage);
  process.exit(1);
}
const experiment: Experiment = (await import(resolve(file))).default;
const { scenario } = experiment;

if (!folders.length) {
  const arms = await prepare(experiment, resolve(file));
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const out = join(repo, "test-results/eval", `${stamp}-${basename(file, ".ts")}`);
  // The pre-registration, with each arm's spec resolved to the commit and patches it ran.
  const registered = { ...experiment, scenario: scenario.name, revision: scenario.revision };
  const specs = Object.fromEntries(arms.map(({ name, spec }) => [name, spec]));
  await Bun.write(
    join(out, "experiment.json"),
    JSON.stringify({ ...registered, arms: specs }, null, 2),
  );
  console.log(`results in ${out}`);
  await runAll(experiment, arms, Number(values.parallel), out);
  folders.push(out);
}

// Each folder's report.json scores its own runs, and the printed report pools them all, beside the
// predictions each folder registered before it ran.
const pooled = { runs: [] as Run[], predictions: new Set<string>() };
for (const folder of folders) {
  const paths = (await Array.fromAsync(new Bun.Glob("*/run.json").scan(folder))).sort();
  if (!paths.length) throw new Error(`${folder} has no runs`);
  const runs: Run[] = await Promise.all(paths.map((path) => Bun.file(join(folder, path)).json()));
  const { predictions = [] } = await Bun.file(join(folder, "experiment.json")).json();
  const report = compare(runs, scenario);
  await Bun.write(join(folder, "report.json"), JSON.stringify(report, null, 2));
  pooled.runs.push(...runs);
  for (const prediction of predictions) pooled.predictions.add(prediction);
}
print(compare(pooled.runs, scenario), scenario, [...pooled.predictions]);
