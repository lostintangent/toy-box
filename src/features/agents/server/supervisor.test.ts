import { describe, expect, mock, onTestFinished, spyOn, test } from "bun:test";
import { AgentDatabase } from "./database";
import { ChannelDatabase } from "@channels/server/database";
import * as state from "@/server/database";
import * as runtime from "@sessions/server/runtime";
import { mentionAgent } from "./supervisor";

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
  test("Channel mentions share one durable admission and wake path", async () => {
    const { agents, agent, channels, create, deliver } = await setup();
    const channel = await channels.createChannel({ title: "Design" });
    const host = { kind: "channel", channelId: channel.id } as const;
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
      expect.objectContaining({ sessionType: "agent" }),
    );
    expect(deliver).toHaveBeenLastCalledWith(member.sessionId, {
      ...input.message,
      immediate: true,
    });
    expect(await channels.getMemberBySession(member.sessionId)).toMatchObject({ seenThrough: 0 });

    await mentionAgent(input);
    expect(create).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  test("an interrupted startup recovers the same membership and Session ID", async () => {
    const { agents, agent, channels, create, deliver } = await setup();
    const channel = await channels.createChannel({ title: "Design" });
    const host = { kind: "channel", channelId: channel.id } as const;
    const input = {
      host,
      agentId: agent.id,
      message: { content: "Review." },
      hostLabel: "Design",
    };
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

  test("starting a Channel turn clears only a prior waiting status", async () => {
    const { agents, agent, channels } = await setup();
    const channel = await channels.createChannel({ title: "Design" });
    const input = {
      host: { kind: "channel", channelId: channel.id } as const,
      agentId: agent.id,
      message: { content: "Review this." },
      hostLabel: "Design",
    };
    await mentionAgent(input);
    const membership = await agents.getMembership(input.host, agent.id);
    const member = await channels.getMemberBySession(membership!.sessionId);

    await channels.setMemberStatus(member!, {
      state: "waiting",
      text: "a new revision",
    });
    await mentionAgent(input);
    expect((await channels.getMemberBySession(member!.sessionId))?.status).toBeUndefined();

    const working = {
      state: "working",
      text: "Reviewing the revision",
    } as const;
    await channels.setMemberStatus(member!, working);
    await mentionAgent(input);
    expect((await channels.getMemberBySession(member!.sessionId))?.status).toEqual(working);
  });

  test("delivery failures do not recreate existing private history", async () => {
    const { agent, channels, create, deliver } = await setup();
    const channel = await channels.createChannel({ title: "Design" });
    const input = {
      host: { kind: "channel", channelId: channel.id } as const,
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
