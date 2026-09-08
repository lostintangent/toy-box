import { describe, expect, mock, onTestFinished, spyOn, test } from "bun:test";
import type { AgentHost } from "@agents/model";
import { AgentDatabase } from "./database";
import { ChannelDatabase } from "@channels/server/database";
import * as state from "@/server/database";
import * as runtime from "@sessions/server/runtime";
import { assertAgentExecutionModeAvailable, mentionAgent } from "./supervisor";

async function setup() {
  const db = await state.createTestDatabase();
  onTestFinished(() => {
    mock.restore();
    return db.close();
  });
  spyOn(state, "getStateDatabase").mockResolvedValue(db);
  const receipt = {
    disposition: "started" as const,
    waitForCompletion: async () => ({ status: "completed" as const }),
  };
  const create = spyOn(runtime, "createSession").mockResolvedValue(receipt);
  const deliver = spyOn(runtime, "deliverSessionMessage").mockResolvedValue(receipt);
  const agents = new AgentDatabase(db);
  const agent = await agents.createAgent({ name: "Critic" });
  return { agents, agent, create, deliver, channels: new ChannelDatabase(db) };
}

describe("Agent membership supervision", () => {
  test("rejects isolated work without a Git directory", async () => {
    await expect(assertAgentExecutionModeAvailable("worktree")).rejects.toThrow(
      "needs a Git working directory",
    );
  });

  test("Session, File, and Channel mentions share one durable admission and wake path", async () => {
    const { agents, agent, channels, create, deliver } = await setup();
    const channel = await channels.createChannel({ title: "Design" });
    const hosts: AgentHost[] = [
      { kind: "session", sessionId: "parent" },
      { kind: "file", sessionId: "parent", path: "spec.md" },
      { kind: "channel", channelId: channel.id },
    ];
    for (const host of hosts) {
      const input = {
        host,
        agentId: agent.id,
        message: { content: "Review this." },
        hostLabel: "Design",
      };
      // Concurrent first mentions must not allocate parallel private Sessions.
      await Promise.all([mentionAgent(input), mentionAgent(input)]);
      const memberships = await agents.listMemberships(host);
      expect(memberships).toHaveLength(1);
      const member = memberships[0]!;
      expect(create).toHaveBeenLastCalledWith(
        member.sessionId,
        input.message,
        expect.objectContaining({ sessionType: "agent", useWorktree: false }),
      );
      expect(deliver).toHaveBeenLastCalledWith(member.sessionId, input.message, {
        immediate: true,
      });
      if (host.kind === "channel") {
        expect(await channels.getMemberBySession(member.sessionId)).toMatchObject({
          seenThrough: 0,
        });
      }
      // A later mention cannot reinterpret an existing membership's workspace.
      await mentionAgent({ ...input, initialExecutionMode: "worktree" });
      expect((await agents.getMembership(host, agent.id))?.executionMode).toBe("shared");
    }
    expect(create).toHaveBeenCalledTimes(3);
    expect(deliver).toHaveBeenCalledTimes(6);
  });

  test("an interrupted startup recovers the same membership and Session ID", async () => {
    const { agents, agent, create, deliver } = await setup();
    const host = { kind: "session", sessionId: "parent" } as const;
    const input = { host, agentId: agent.id, message: { content: "Review." }, hostLabel: "Design" };
    create.mockRejectedValueOnce(new Error("SDK unavailable"));
    await expect(mentionAgent(input)).rejects.toThrow("SDK unavailable");
    const admitted = await agents.getMembership(host, agent.id);
    deliver.mockRejectedValueOnce(new Error("Session not found"));
    await mentionAgent(input);
    expect(await agents.getMembership(host, agent.id)).toEqual(admitted);
    expect(create.mock.calls.map(([sessionId]) => sessionId)).toEqual([
      admitted!.sessionId,
      admitted!.sessionId,
    ]);
  });

  test("delivery failures do not recreate existing private history", async () => {
    const { agent, create, deliver } = await setup();
    const input = {
      host: { kind: "session", sessionId: "parent" } as const,
      agentId: agent.id,
      message: { content: "Review." },
      hostLabel: "Design",
    };
    await mentionAgent(input);
    deliver.mockRejectedValueOnce(new Error("Delivery unavailable"));
    await expect(mentionAgent(input)).rejects.toThrow("Delivery unavailable");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
