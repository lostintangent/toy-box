import { describe, expect, test } from "bun:test";
import type { SessionState } from "@sessions/model";
import { loadSessionFixture, replayCopilotHistory } from "./helpers";

// Golden replay of the HISTORY pipeline — the resume/replay consumption mode:
// native events → provider projector → shared history reducer → idle Session.
describe("history pipeline golden replay", () => {
  function agentToolCalls(state: SessionState) {
    return state.messages.flatMap((m) =>
      m.role === "assistant" ? (m.toolCalls ?? []).filter((tc) => tc.name === "agent") : [],
    );
  }

  test("replaying a recorded session produces the final session state", async () => {
    const state = await replayCopilotHistory(
      "history-golden-session",
      await loadSessionFixture("subagents"),
    );
    expect(state.messages.map((message) => message.role)).toEqual([
      "assistant",
      "user",
      "assistant",
    ]);
    expect(state.model).toMatchObject({
      provider: "copilot",
      name: "gpt-5.5",
      reasoningEffort: "xhigh",
    });

    // Every subagent's work is grouped under its agent call...
    const agents = agentToolCalls(state);
    expect(agents).toHaveLength(7);
    const childCounts = agents
      .map((tc) => tc.subagent?.toolCalls?.length ?? 0)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    expect(childCounts).toEqual([3, 4]);

    // ...subagent assistant messages stay nested, while root tool calls remain
    // visible even if they appear before the first recorded user message...
    const assistantMessages = state.messages.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0].toolCalls?.[0]).toMatchObject({
      id: "call_M1QBw3fDmRrrXoYP9bt4edOd",
      name: "read",
      result: { success: false, content: "Path does not exist" },
    });
    expect(
      agents.some((tc) => tc.subagent?.content?.includes("examining the uncommitted changes")),
    ).toBe(true);

    // ...and replay fully resolves transient status.
    expect(state.status).toBe("idle");
    expect(state).toMatchSnapshot();
  });

  test("a rate-limited subagent fails its agent call without ending the root turn", async () => {
    const state = await replayCopilotHistory(
      "history-golden-subagent-rate-limit",
      await loadSessionFixture("subagentRateLimit"),
    );

    // The subagent's rate limit surfaces on its agent call...
    const agents = agentToolCalls(state);
    expect(agents).toHaveLength(1);
    expect(agents[0].result).toMatchObject({ success: false });
    expect(agents[0].result?.content).toContain("rate-limited (user_model_rate_limited)");

    // ...rather than as the root turn's error, so the root's answer that follows it survives.
    expect(state.messages.filter((m) => m.role === "assistant" && m.error)).toEqual([]);
    expect(state.messages.at(-1)?.content).toContain("The subagent failed due to rate limiting");
    expect(state.status).toBe("idle");
    expect(state).toMatchSnapshot();
  });
});
