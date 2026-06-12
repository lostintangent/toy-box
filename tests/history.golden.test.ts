import { describe, expect, test } from "bun:test";
import { initializeSessionStateFromSdkHistory } from "@/functions/sdk/historyReplay";
import type { Session } from "@/lib/session/sessionReducer";
import { loadSessionFixture } from "./helpers";

// Golden replay of the HISTORY pipeline — the resume/replay consumption mode:
// raw v1 CLI events → projector (history mode) → sessionReducer → final
// Session state, via the same production entry point the server uses when a
// client opens a recorded session. Layer-level regressions are caught by the
// unit suites beside each module; this locks the end-to-end contract.
describe("history pipeline golden replay", () => {
  function agentToolCalls(state: Session) {
    return state.messages.flatMap((m) =>
      m.role === "assistant" ? (m.toolCalls ?? []).filter((tc) => tc.name === "agent") : [],
    );
  }

  test("replaying a recorded session produces the final session state", async () => {
    const state = await initializeSessionStateFromSdkHistory(await loadSessionFixture("subagents"));

    // Every subagent's work is grouped under its agent call...
    const agents = agentToolCalls(state);
    expect(agents).toHaveLength(7);
    const childCounts = agents
      .map((tc) => tc.agent?.toolCalls?.length ?? 0)
      .filter((n) => n > 0)
      .sort();
    expect(childCounts).toEqual([3, 4]);

    // ...subagent assistant messages stay out of the top-level transcript...
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(
      agents.some((tc) => tc.agent?.content?.includes("examining the uncommitted changes")),
    ).toBe(true);

    // ...and replay fully resolves transient state.
    expect(state.status).toBe("idle");
    expect(state.pendingToolCalls.size).toBe(0);

    expect({
      ...state,
      pendingToolCalls: [...state.pendingToolCalls.entries()],
    }).toMatchSnapshot();
  });
});
