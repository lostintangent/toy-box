import { describe, expect, mock, onTestFinished, spyOn, test } from "bun:test";
import { AgentDatabase } from "@agents/server/database";
import * as state from "@/server/database";
import * as runtime from "./runtime";
import { resolveSessionAgentMentions, sendAgentResponse } from "./agentHost";

async function setup() {
  const db = await state.createTestDatabase();
  spyOn(state, "getStateDatabase").mockResolvedValue(db);
  const agents = new AgentDatabase(db);
  const agent = await agents.createAgent({ name: "Critic" });
  onTestFinished(() => {
    mock.restore();
    return db.close();
  });
  return { agents, agent };
}

describe("Session Agent host", () => {
  test("resolves text once and retains stable queued recipients after an Agent rename", async () => {
    const { agents, agent } = await setup();
    const queued = await resolveSessionAgentMentions({
      role: "user",
      clientId: "input",
      content: "@critic review",
    });
    expect(queued.agentMentions).toEqual([{ agentId: agent.id }]);
    await agents.updateAgent({ agentId: agent.id, name: "Reviewer" });
    expect((await resolveSessionAgentMentions(queued)).agentMentions).toEqual([
      { agentId: agent.id },
    ]);
  });

  test("publishes attributed responses without requiring or completing Agent identity work", async () => {
    const { agents, agent } = await setup();
    await agents.createMembership({
      host: { kind: "session", sessionId: "parent" },
      agentId: agent.id,
      sessionId: "critic-session",
      executionMode: "shared",
    });
    const deliver = spyOn(runtime, "deliverSessionMessage").mockResolvedValue({
      disposition: "started",
      waitForCompletion: async () => ({ status: "completed" }),
    });
    await sendAgentResponse("critic-session", "A useful contribution.");
    expect(deliver).toHaveBeenCalledWith(
      "parent",
      {
        systemMessage: {
          type: "agent_response",
          name: "Critic",
          avatar: undefined,
          executionMode: "shared",
          content: "A useful contribution.",
        },
      },
      { immediate: true },
    );
    expect((await agents.getAgent(agent.id))?.avatar).toBeUndefined();
  });
});
