# Evals

Did a change to instructions, tools or a model make agents worse at something we care about? An eval answers that by running the same scripted work on each variant several times, scoring every run against criteria written before it ran, and flagging where a variant falls behind. It runs straight from source with bun, and every run gets its own HOME, server and work folder, so it never touches yours.

```
evals/           everything below, plus this README with the method
  harness/       runs an experiment's arms through its scenario, records each run, scores and compares (copied unchanged)
  adapter/       plugs Toy Box into the harness: a sandboxed server, messages, and reading back what happened
  scenarios/     channel-lead.ts (the script) and channel-lead.scorecard.ts (its scorecard)
  experiments/   opus-vs-gemini.ts (arms, runs and predictions: the pre-registration)
```

The nouns, one per type in `harness/index.ts`:

- **Experiment:** arms, runs and predictions, registered before any run. The first arm is the baseline.
- **Arm:** one variant: a tree (a ref plus any patches) and a model.
- **Scenario:** a script plus a scorecard. Its revision goes up whenever its fixture, setup or script changes.
- **Step:** one user message in the script, sent when its trigger gives a reason.
- **Scorecard:** criteria, which pass, miss with a reason, or don't apply, and measures, one number per run.
- **Adapter:** the only project-specific code. It builds a tree, starts a system for each run, and views a finished run in the words its scorecards use.
- **System:** the product, live during one run. The harness waits for it to rest and sends it messages.
- **Sandbox:** a run's own HOME, work folder and environment, so nothing touches the real ones. A Claude arm is the one exception: it shares the login keychain.
- **Run:** one arm through one scenario, kept as JSON, so a later scorecard can rescore it.
- **Report:** the runs scored and compared, flagging where an arm trails the baseline by more than the noise rule allows.

## Running one

Write an experiment, then run it. Results go in `test-results/eval/<time>-<experiment>/`, one folder per run plus `experiment.json` (what was registered) and `report.json`:

```sh
bun eval evals/experiments/opus-vs-gemini.ts --parallel 2
```

An arm is `<ref>[+<patch>…]:<provider>/<model>[@<effort>]`. Each ref and set of patches is exported and built once in `$TMPDIR/evals`, never in your checkout, so to measure uncommitted work, save it with `git diff > evals/experiments/mine.patch` and name it after a ref. Most changes only touch how a lead starts, so `through: "kickoff"` stops each run at the lead's first rest. That takes about a minute with Opus, which makes 8 runs per arm affordable.

Give the experiment and some results folders to score them again, pooled, for example after changing a criterion or to add runs to an earlier batch. Each folder keeps the predictions it registered:

```sh
bun eval evals/experiments/opus-vs-gemini.ts test-results/eval/<folder> [<folder>…]
```

Patches stay local, since `.gitignore` covers `evals/**/*.patch`. Commit an experiment only when every arm is a ref, so anyone can run it again from the repo.

## The method

- **Register first.** Write the arms, runs and predictions before anything runs, and don't edit them after. A criterion changed after seeing results gets rescored beside the original prediction, which stays recorded as missed.
- **Every run ends with one outcome.** It's completed when the script ran to its end, stalled when the scenario's cap passed first, failed on an error, interrupted on Ctrl-C, and invalid when it measured something else, like a model its server doesn't offer. Only completed runs are scored, so retry the rest rather than count them as misses. Whatever the outcome, the run's JSON is written, its system ends and its sandbox is removed.
- **A criterion whose step was never sent doesn't apply.** The report shows `passes/scored` for each criterion and each arm's outcomes, so it's plain how many runs it took to get the completed ones.
- **The noise rule.** A criterion is flagged when a candidate has 2 or more fewer passes than the baseline. That's a threshold for a closer look, not proof of a regression. Treat a flag as one only when the rule it governs changed, or when it reproduces in 3 fresh runs. Passes are compared, not rates, so an arm with fewer completed runs can be flagged for that alone.
- **Sample size.** At 3 runs per arm only gross regressions show up. A criterion that passes about 70% of the time needs about 8 runs per arm to separate.
- **Rescore, don't rerun.** Changing a scorecard rescores old runs with no revision bump. Changing what a run starts from, or what the script asks, or when, bumps the revision, and runs of different revisions never pool. Neither do completed runs that sent different steps, or two specs under one arm name.

## Isolation

Each run gets fresh HOME, temp, bin and work folders, with the fixture committed as the work folder's only commit. Its environment holds only HOME, TMPDIR, PATH, LANG, USER, SHELL and the arm's credential. Copilot takes `COPILOT_GITHUB_TOKEN` or `gh auth token`. Claude shares your login keychain, so its runs use your real login and aren't isolated from it. Codex gets nothing, since refreshing a copy of its login would rotate the real one, so its runs are invalid.

The Toy Box adapter starts the arm's server on a free port that's never 3100, in its own process group, with the other providers turned off and the arm's model as the member default. A fake `tailscale` first on PATH reports no peers, so no server reaches the tailnet. Each run records its provider CLI's version line as `cli`, read the way its server finds that CLI, so a batch that straddles a CLI update shows in its runs. No registry credentials reach a run, though an agent can still install public packages.

When a run ends, however it ends, the adapter ends the server and every process descended from it, wherever it moved and whatever group it joined, along with any process in a group one of them leads, and then the harness removes the run's folders. Nothing the run didn't start is touched. A process whose parent exited during the run and whose group's leader isn't among them, like a job an agent backgrounded in a shell command that has since returned, belongs to launchd and escapes, and so does everything if the harness itself is killed.

## Adding to it

- **A criterion or measure** is one entry in its scorecard. Return a string saying why it missed rather than false, then rescore old results to see what it says about runs you already have.
- **A scenario** is a script file and a scorecard file in `scenarios/`. Channels decides what the channel scenarios and their criteria mean, so changes to `channel-lead` go through them.
- **A project** copies `harness/` unchanged and writes an adapter: `build` a tree once, `start` a system in a run's sandbox (or return why the arm can't run as asked), and `view` a finished run in its scorecards' words. Its scenarios and experiments import only `harness/index.ts` and the adapter.
- **Tests** cover the parts every run depends on: how a transcript splits into turns, a run's lifecycle against a fake system, ending only the processes a server started, and the scoring and pooling rules (`bun test evals`).
