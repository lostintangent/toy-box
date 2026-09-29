import { describe, expect, test } from "bun:test";
import { channelAgentPresence } from "./presence";

const working = { status: { state: "working", text: "Re-running perf gates" } } as const;
const waiting = { status: { state: "waiting", text: "Your feedback on HTTPS" } } as const;

describe("channel agent presence", () => {
  test("a running agent is working, with the status it set", () => {
    expect(channelAgentPresence(working, true)).toEqual({
      state: "working",
      text: "Re-running perf gates",
    });
    expect(channelAgentPresence({}, true)).toEqual({ state: "working" });
  });

  test("an idle agent can still be waiting", () => {
    expect(channelAgentPresence(waiting, false)).toEqual({
      state: "waiting",
      text: "Your feedback on HTTPS",
    });
  });

  test("a working status without a running session is idle", () => {
    expect(channelAgentPresence(working, false)).toEqual({ state: "idle" });
    expect(channelAgentPresence({}, false)).toEqual({ state: "idle" });
  });

  test("running takes precedence over a waiting status", () => {
    expect(channelAgentPresence(waiting, true)).toEqual({ state: "working" });
  });
});
