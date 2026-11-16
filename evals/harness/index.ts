// The contract: one type per noun in the README. An adapter, a scenario and an experiment import
// only these, so the harness can be copied into another project unchanged.

/** One question put to the eval: its arms, how many runs each gets, and what's predicted, all
 *  registered before anything runs. The first arm is the baseline. */
export type Experiment = {
  scenario: Scenario<any, any, any>;
  runs: number;
  /** The last step to send, or "kickoff" to measure the kickoff alone. Every step by default. */
  through?: string;
  /** By name: `<ref>[+<patch>…]:<provider>/<model>[@<effort>]`, with patches relative to this file. */
  arms: Record<string, string>;
  predictions: string[];
};

/** One variant: a tree (a ref plus any patches) and a model. `spec` is what its name resolved to. */
export type Arm = {
  name: string;
  spec: string;
  tree: string;
  provider: string;
  model: string;
  effort?: string;
};

/** A script plus a scorecard. */
export type Scenario<Setup, State, View> = {
  name: string;
  /** Bumped when the script changes. Runs of different revisions never pool, and a changed
   *  scorecard rescores old runs instead. */
  revision: number;
  adapter: Adapter<Setup, State, View>;
  /** Minutes before a run that hasn't ended is recorded as stalled. */
  cap: number;
  /** The work folder's files, committed as its only commit. */
  fixture: Record<string, string>;
  setup: Setup;
  script: Step<State>[];
  scorecard: Scorecard<View>;
};

/** One user message, sent once the system rests and its trigger gives a reason. */
export type Step<State> = {
  id: string;
  content: string;
  /** At each rest, and every 30 s while resting: why to send now, or undefined to wait. `since`
   *  is the minutes since the last step was sent, or since the start. */
  trigger(progress: { minutes: number; since: number; state: State }): string | undefined;
};

/** Criteria pass (true), miss (false, or a string saying why) or don't apply (null). A criterion
 *  reads the turns that handled its step, or the whole "run", and a step never sent scores null.
 *  Measures are one number per run, and the report shows each arm's median. */
export type Scorecard<View> = {
  criteria: {
    id: string;
    step: string;
    governs: string;
    check: (view: View) => boolean | string | null;
  }[];
  measures: { id: string; description: string; measure: (view: View) => number | undefined }[];
};

/** The project-specific part: build a tree once, start a system per run, view a finished run. */
export type Adapter<Setup, State, View> = {
  build(tree: string): Promise<void>;
  /** The run's live system, or why this arm can't run as asked, having stopped what it started. */
  start(arm: Arm, sandbox: Sandbox, setup: Setup): Promise<System<State> | string>;
  view(run: Run): View;
};

/** The product, live during one run. */
export type System<State> = {
  /** Resolves at the next rest or after `ms`, whichever comes first, with the state if the system
   *  is resting then and has rested since the last message. Rejects when the sandbox's signal
   *  aborts. */
  settle(ms: number): Promise<State | undefined>;
  /** Sends a user message and returns when it was sent. */
  send(content: string): Promise<string>;
  /** Reads back what the run keeps and stops everything, with why a completed run measured
   *  something else, if it did. Never throws. */
  end(): Promise<{ evidence: object; invalid?: string }>;
};

/** A run's own HOME, temp, bin (first on PATH) and work folders, its environment, its abort
 *  signal, and the folder its results go in, for logs the adapter keeps. */
export type Sandbox = {
  home: string;
  tmp: string;
  bin: string;
  work: string;
  env: Record<string, string>;
  signal: AbortSignal;
  out: string;
};

/** One arm through one scenario, as its run.json keeps it, with the adapter's evidence beside
 *  these fields. Times are ISO strings on this machine's clock. */
export type Run = {
  id: string;
  arm: string;
  spec: string;
  scenario: string;
  revision: number;
  /** Only completed runs are scored. An invalid run ended but measured something else. */
  outcome: "completed" | "stalled" | "failed" | "interrupted" | "invalid";
  reason?: string;
  startedAt: string;
  endedAt: string;
  steps: { id: string; trigger: string; at: string }[];
  [evidence: string]: unknown;
};

/** Each arm's runs scored, with a flag wherever a candidate trails the baseline by the noise rule. */
export type Report = {
  arms: {
    name: string;
    spec: string;
    runs: {
      id: string;
      outcome: Run["outcome"];
      verdicts: Record<string, boolean | string | null>;
      measures: Record<string, number | undefined>;
    }[];
    medians: Record<string, number | undefined>;
  }[];
  flags: { arm: string; criterion: string }[];
};
