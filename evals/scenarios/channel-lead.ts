// A lead plans a small CLI on top of an earlier spike, asks the user one question, regroups its
// tasks on request, sets up a routine, and runs three checks of different lengths. Changing what
// the channel starts with, or what the user asks, or when, bumps the revision.
import type { ChannelState } from "@channels/model";
import adapter, { type ChannelSetup } from "../adapter";
import { type ChannelView, organic, walk } from "../adapter/view";
import type { Scenario } from "../harness";
import scorecard, { checks } from "./channel-lead.scorecard";

const purpose =
  "Build a small TypeScript CLI named notes in the working directory, runnable with bun, with add and list " +
  "subcommands that store notes as JSON, in one file with one bun test. First write a short design note on " +
  "subcommand naming that builds on our naming survey, then implement the CLI. Before anyone builds storage, " +
  "I want to make the call myself on whether notes live in one notes.json file or one file per note. A " +
  "separate reviewer should check the finished CLI against the design note before we call it done. Our " +
  "earlier spike is already in the task list, and its naming survey is now published in docs/conventions.md " +
  "and noted in CHANGELOG.md.";

// The spike: a survey published as conventions, its drafts shared as artifacts, and its tasks done
// except the help text, which the CLI still needs, and a docs audit that's half done, with its done
// half recorded and the rest waiting on another team.
const fixture = {
  "docs/conventions.md": `# CLI conventions

Published from our naming survey.

- Subcommands are short lowercase verbs: \`add\`, \`list\`.
- Flags use long kebab-case names, with single-letter aliases only for the most common ones.
- \`--help\` on every subcommand prints a one-line summary, usage, and one example.
- Errors go to stderr with a nonzero exit code.
`,
  "drafts/survey.md": `# CLI naming survey (draft)

Compared git, gh, bun, and npm. All use short lowercase verbs for subcommands and long kebab-case flags.
Findings are now published in docs/conventions.md.
`,
  "drafts/help-examples.md": `# Help text examples

    notes add "Buy milk"     Add a note
    notes list               List notes, newest first
`,
  "CHANGELOG.md": `# Changelog

## Unreleased

- Published the CLI naming survey as docs/conventions.md.
- Audited docs/conventions.md against the survey: every rule matches.
`,
  // M5's checks. Each prints its verdict and then the moment it finishes, which it also appends to
  // runs.log beside it, so the scorecard knows when it exited however an agent ran or read it.
  "scripts/quick-check.sh": `# Lints and formats every file. Takes about 10 seconds.
echo "quick-check: scanning"
sleep 10
echo "quick-check: 312 files clean"
echo "quick-check finished at $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$(dirname "$0")/runs.log"
`,
  "scripts/smoke.sh": `# Runs the end-to-end smoke flows. Takes about a minute and a half.
for batch in 1 2 3 4 5 6; do
  sleep 15
  echo "smoke: batch $batch of 6 passed"
done
echo "smoke: 118 of 118 flows passed"
echo "smoke finished at $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$(dirname "$0")/runs.log"
`,
  "scripts/nightly.sh": `# Runs the full nightly suite. Takes about three minutes.
for shard in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 15
  echo "nightly: shard $shard of 12 done"
done
echo "nightly: 1,284 of 1,286 passed, 2 failed: search_across_lines, export_with_emoji"
echo "nightly finished at $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$(dirname "$0")/runs.log"
exit 1
`,
};

const setup: ChannelSetup = {
  name: "Notes",
  purpose,
  artifacts: {
    survey: { path: "drafts/survey.md", title: "CLI naming survey" },
    examples: { path: "drafts/help-examples.md", title: "Help text examples" },
  },
  tasks: [
    {
      id: "survey",
      title: "Survey CLI naming conventions",
      status: "done",
      artifact: "survey",
      children: [
        {
          id: "examples",
          title: "Collect help text examples",
          status: "done",
          artifact: "examples",
        },
      ],
    },
    { id: "npm", title: "Check the notes name is free on npm", status: "done" },
    {
      id: "help",
      title: "Write help text for each subcommand",
      status: "pending",
      artifact: "examples",
    },
    {
      id: "audit",
      title: "Audit the spike's docs before we build on them",
      status: "in_progress",
      children: [
        { id: "audit-conventions", title: "Audit docs/conventions.md", status: "done" },
        {
          id: "audit-site",
          title: "Audit the docs site once the docs team finishes migrating it",
          status: "blocked",
        },
      ],
    },
  ],
};

const seeded = new Set(walk(setup.tasks).map(({ task }) => task.id));
/** The tasks agents added, and how many of them are done. */
const grown = (state: ChannelState) => {
  const added = walk(state.channel.tasks).filter(({ task }) => organic(task, seeded));
  return { added: added.length, done: added.filter(({ task }) => task.status === "done").length };
};

export default {
  name: "channel-lead",
  revision: 5,
  adapter,
  cap: 45,
  fixture,
  setup,
  script: [
    {
      id: "M2",
      content: "One notes.json file.",
      trigger: ({ state }) => (state.request ? "request open" : "first rest"),
    },
    {
      id: "M3",
      content:
        "Please regroup the task list into two milestones, Design and Build, and move the help-text task under Build.",
      trigger: ({ state, since }) =>
        grown(state).done ? "organic done" : since >= 3 ? "3 minutes after M2" : undefined,
    },
    {
      id: "M4",
      content:
        "Could you check every weekday at 9am that the notes CLI's tests still pass, and tell me if anything breaks?",
      trigger: ({ state, since }) => {
        const { added, done } = grown(state);
        return added && done === added
          ? "all organic done"
          : since >= 3
            ? "3 minutes after M3"
            : undefined;
      },
    },
    // Each check's length is stated, so agents choose how to wait by it rather than by discovery.
    {
      id: "M5",
      content:
        "Can you run our three checks and tell me what each one reports? `sh scripts/quick-check.sh` takes a few seconds, `sh scripts/smoke.sh` about a minute and a half, and `sh scripts/nightly.sh` about three minutes.",
      trigger: () => "first rest",
    },
    // A run ends at the lead's rest after the last step, so this keeps it going until nightly is
    // reported, or long enough for a lead that blocks on every check or waits on a 5-minute timer.
    {
      id: "M6",
      content: "Thanks, that's all I needed today.",
      trigger: ({ state, since }) =>
        state.messages.some(
          (message) =>
            message.sender.type === "agent" &&
            typeof message.content === "string" &&
            Date.parse(message.timestamp) > Date.now() - since * 60_000 &&
            checks.nightly.verdict.test(message.content),
        )
          ? "nightly reported"
          : since >= 10
            ? "10 minutes after M5"
            : undefined,
    },
  ],
  scorecard,
} satisfies Scenario<ChannelSetup, ChannelState, ChannelView>;
