// Does Gemini lead a channel as well as Opus, now that Copilot gives it real union schemas (gsf)?
// Registered before any run: the first arm is the baseline, and every prediction is checked
// against the report.
import type { Experiment } from "../harness";
import channelLead from "../scenarios/channel-lead";

export default {
  scenario: channelLead,
  runs: 3,
  arms: {
    opus: "HEAD:copilot/claude-opus-5.5@high",
    gemini: "HEAD:copilot/gemini-4-carbon@high",
  },
  predictions: [
    "T2 and T2.m pass 3/3 in both arms, since no channel tool call fails on a union schema",
    "Nothing is flagged for gemini",
    "gemini's median kickoff is several times opus's, from model latency rather than the tools",
  ],
} satisfies Experiment;
