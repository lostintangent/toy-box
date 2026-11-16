// A lead plans a small CLI on top of an earlier spike, asks the user one question, regroups its
// tasks on request, and sets up a routine. Changing what the user asks, or when, bumps the revision.
import type { ChannelState } from "@channels/model";
import adapter, { type ChannelSetup } from "../adapter";
import { type ChannelView, organic, walk } from "../adapter/view";
import type { Scenario } from "../harness";
import scorecard from "./channel-lead.scorecard";

const purpose =
  "Build a small TypeScript CLI named notes in the working directory, runnable with bun, with add and list " +
  "subcommands that store notes as JSON, in one file with one bun test. First write a short design note on " +
  "subcommand naming that builds on our naming survey, then implement the CLI. Before anyone builds storage, " +
  "I want to make the call myself on whether notes live in one notes.json file or one file per note. A " +
  "separate reviewer should check the finished CLI against the design note before we call it done. Our " +
  "earlier spike is already in the task list, and its naming survey is now published in docs/conventions.md " +
  "and noted in CHANGELOG.md.";

// The spike: a survey published as conventions, its drafts shared as artifacts, and its tasks done
// except the help text, which the CLI still needs.
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
  revision: 2,
  adapter,
  cap: 35,
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
  ],
  scorecard,
} satisfies Scenario<ChannelSetup, ChannelState, ChannelView>;
