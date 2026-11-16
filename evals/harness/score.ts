import type { Report, Run, Scenario } from ".";

type Scored = Report["arms"][number]["runs"][number];

/** A run's verdicts and measures. Only completed runs are scored, and a criterion whose step was
 *  never sent doesn't apply. */
export function score(run: Run, scenario: Scenario<any, any, any>): Scored {
  const { id, outcome } = run;
  if (outcome !== "completed") return { id, outcome, verdicts: {}, measures: {} };
  const view = scenario.adapter.view(run);
  const reached = (step: string) =>
    step === "run" || step === "kickoff" || run.steps.some((sent) => sent.id === step);
  const { criteria, measures } = scenario.scorecard;
  return {
    id,
    outcome,
    verdicts: Object.fromEntries(
      criteria.map(({ id, step, check }) => [id, reached(step) ? check(view) : null]),
    ),
    measures: Object.fromEntries(measures.map(({ id, measure }) => [id, measure(view)])),
  };
}

/** Scores runs pooled from results folders, with their arms in the order of their first run, so
 *  the first is the baseline. It refuses runs that can't be compared: one arm name with two specs,
 *  another scenario or revision, or completed runs that sent different steps. A candidate is
 *  flagged where it has 2 or more fewer passes than the baseline: a threshold for a closer look. */
export function compare(runs: Run[], scenario: Scenario<any, any, any>): Report {
  const sent = ({ steps }: Run) => steps.map(({ id }) => id).join(", ");
  const completed = runs.find(({ outcome }) => outcome === "completed");
  for (const run of runs) {
    const first = runs.find(({ arm }) => arm === run.arm)!;
    if (run.spec !== first.spec)
      throw new Error(
        `${first.id} and ${run.id} are both ${run.arm} but ran ${first.spec} and ${run.spec}`,
      );
    if (run.scenario !== scenario.name || run.revision !== runs[0]!.revision)
      throw new Error(
        `${run.id} ran ${run.scenario} revision ${run.revision}, not ${runs[0]!.revision}`,
      );
    if (run.outcome === "completed" && sent(run) !== sent(completed!))
      throw new Error(`${completed!.id} and ${run.id} sent different steps`);
  }
  const arms = [...new Set(runs.map(({ arm }) => arm))].map((name) => {
    const own = runs.filter(({ arm }) => arm === name).map((run) => score(run, scenario));
    const medians = scenario.scorecard.measures.map(({ id }) => [id, median(own, id)]);
    return {
      name,
      spec: runs.find(({ arm }) => arm === name)!.spec,
      runs: own,
      medians: Object.fromEntries(medians),
    };
  });
  const flags = scenario.scorecard.criteria.flatMap(({ id }) => {
    const baseline = tally(arms[0]!, id).passes;
    return arms
      .slice(1)
      .flatMap((arm) =>
        baseline - tally(arm, id).passes >= 2 ? [{ arm: arm.name, criterion: id }] : [],
      );
  });
  return { arms, flags };
}

/** Each arm's outcomes, so it's plain how many runs it took to get the completed ones, then each
 *  criterion's passes over the runs it was scored in, each measure's median, the flags and the
 *  predictions to check them against. */
export function print(report: Report, scenario: Scenario<any, any, any>, predictions: string[]) {
  const { criteria, measures } = scenario.scorecard;
  const row = (cell: (arm: Report["arms"][number]) => string) =>
    Object.fromEntries(report.arms.map((arm) => [arm.name, cell(arm)]));
  const flagged = (id: string) =>
    report.flags.filter(({ criterion }) => criterion === id).map(({ arm }) => arm);
  const outcomes = ["completed", "stalled", "failed", "interrupted", "invalid"] as const;
  console.table({
    ...Object.fromEntries(
      outcomes.map((outcome) => [
        `${outcome} runs`,
        row(({ runs }) => String(runs.filter((run) => run.outcome === outcome).length)),
      ]),
    ),
    ...Object.fromEntries(
      criteria.map(({ id }) => [
        id,
        {
          ...row((arm) => `${tally(arm, id).passes}/${tally(arm, id).scored}`),
          ...(flagged(id).length > 0 && { flagged: flagged(id).join(", ") }),
        },
      ]),
    ),
    ...Object.fromEntries(
      measures.map(({ id }) => [id, row(({ medians }) => medians[id]?.toFixed(1) ?? "-")]),
    ),
  });
  console.log(
    [
      report.flags.length
        ? "Flagged (check against the noise rule):"
        : "Nothing flagged; every gap is within noise.",
      ...criteria.flatMap(({ id, governs }) =>
        flagged(id).length ? [`  ${id} ${flagged(id).join(", ")}: ${governs}`] : [],
      ),
      "",
      "Predictions:",
      ...predictions.map((prediction) => `  - ${prediction}`),
    ].join("\n"),
  );
}

/** Passes over the completed runs a criterion applied to. */
function tally({ runs }: Report["arms"][number], id: string) {
  const scored = runs.map(({ verdicts }) => verdicts[id]).filter((verdict) => verdict != null);
  return { passes: scored.filter((verdict) => verdict === true).length, scored: scored.length };
}

function median(runs: Scored[], id: string) {
  const values = runs.flatMap(({ measures }) => measures[id] ?? []).sort((a, b) => a - b);
  const middle = values.length / 2;
  if (!values.length) return undefined;
  return values.length % 2
    ? values[Math.floor(middle)]
    : (values[middle - 1]! + values[middle]!) / 2;
}
