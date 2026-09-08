import { describe, expect, onTestFinished, test } from "bun:test";
import { AgentDatabase } from "@agents/server/database";
import { machineFile, sessionFile } from "@files/model";
import { createTestDatabase } from "@/server/database";
import { ChannelDatabase } from "./database";

async function openChannels() {
  const database = await createTestDatabase();
  onTestFinished(() => database.close());
  return {
    agents: new AgentDatabase(database),
    channels: new ChannelDatabase(database),
  };
}

describe("channel database", () => {
  test("stores structural membership and an ordered transcript", async () => {
    const { agents, channels } = await openChannels();
    const channel = await channels.createChannel({
      title: "Release room",
      directory: "/workspace/project",
    });
    const critic = await agents.createAgent({ name: "Critic" });
    const { member } = await channels.createMember({
      channelId: channel.id,
      agentId: critic.id,
      sessionId: "critic-session",
      executionMode: "shared",
    });

    const { message: first } = await channels.appendMessage({
      id: "message-1",
      channelId: channel.id,
      sender: { type: "user" },
      content: "@critic Please check the invitation flow.",
      attachments: [{ displayName: "flow.png", mimeType: "image/png", base64: "aW1hZ2U=" }],
    });
    await channels.appendMessage({
      id: "message-2",
      channelId: channel.id,
      sender: { type: "system" },
      content: "Critic joined the channel",
    });
    await channels.appendMessage({
      id: "message-3",
      channelId: channel.id,
      sender: {
        type: "agent",
        agentId: critic.id,
      },
      content: "The empty state is clear.",
    });

    expect(first.sequence).toBe(1);
    expect(await channels.listMembers(channel.id)).toEqual([member]);
    expect((await channels.getChannel(channel.id))?.latestSequence).toBe(3);
    const messages = await channels.listMessages(channel.id);
    expect(messages[0]?.attachments).toEqual(first.attachments);
    expect(messages.map(({ sender, content }) => ({ sender, content }))).toEqual([
      {
        sender: { type: "user" },
        content: "@critic Please check the invitation flow.",
      },
      { sender: { type: "system" }, content: "Critic joined the channel" },
      {
        sender: { type: "agent", agentId: critic.id },
        content: "The empty state is clear.",
      },
    ]);
  });

  test("serializes concurrent writers on the shared SQLite connection", async () => {
    const { channels } = await openChannels();
    const channel = await channels.createChannel({ title: "Concurrent room" });

    const changes = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        channels.appendMessage({
          id: `message-${index + 1}`,
          channelId: channel.id,
          sender: { type: "user" },
          content: `Concurrent message ${index + 1}`,
        }),
      ),
    );

    const expectedSequences = Array.from({ length: 12 }, (_, index) => index + 1);
    expect(changes.map(({ message }) => message.sequence)).toEqual(expectedSequences);
    expect(changes.map(({ cursor }) => cursor)).toEqual(expectedSequences);
    expect((await channels.getChannel(channel.id))?.latestSequence).toBe(12);
    expect((await channels.listMessages(channel.id)).map(({ sequence }) => sequence)).toEqual(
      expectedSequences,
    );
  });

  test("sets and clears one current reaction per Agent without changing message cursors", async () => {
    const { agents, channels } = await openChannels();
    const channel = await channels.createChannel({ title: "Reaction room" });
    const [reviewer, designer] = await Promise.all([
      agents.createAgent({ name: "Reviewer" }),
      agents.createAgent({ name: "Designer" }),
    ]);
    await channels.appendMessage({
      id: "message-1",
      channelId: channel.id,
      sender: { type: "user" },
      content: "The direction is approved.",
    });
    const channelBeforeReactions = await channels.getChannel(channel.id);

    await Promise.all([
      channels.setMessageReaction({
        channelId: channel.id,
        sequence: 1,
        agentId: reviewer.id,
        reaction: "looking",
      }),
      channels.setMessageReaction({
        channelId: channel.id,
        sequence: 1,
        agentId: designer.id,
        reaction: "celebrate",
      }),
    ]);
    await channels.setMessageReaction({
      channelId: channel.id,
      sequence: 1,
      agentId: reviewer.id,
      reaction: "agree",
    });

    const reactions = (await channels.listMessages(channel.id))[0]?.reactions;
    expect(reactions).toHaveLength(2);
    expect(reactions).toEqual(
      expect.arrayContaining([
        { agentId: designer.id, reaction: "celebrate" },
        { agentId: reviewer.id, reaction: "agree" },
      ]),
    );
    await channels.setMessageReaction({
      channelId: channel.id,
      sequence: 1,
      agentId: reviewer.id,
      reaction: null,
    });
    await channels.setMessageReaction({
      channelId: channel.id,
      sequence: 1,
      agentId: reviewer.id,
      reaction: null,
    });
    expect((await channels.listMessages(channel.id))[0]?.reactions).toEqual([
      { agentId: designer.id, reaction: "celebrate" },
    ]);
    expect(await channels.getChannel(channel.id)).toEqual(channelBeforeReactions);
  });

  test("tracks independent human and agent unread cursors", async () => {
    const { agents, channels } = await openChannels();
    const channel = await channels.createChannel({ title: "Planning" });
    const agent = await agents.createAgent({ name: "Planner" });
    const { member } = await channels.createMember({
      channelId: channel.id,
      agentId: agent.id,
      sessionId: "planner-session",
      executionMode: "shared",
    });
    await channels.appendMessage({
      id: "message-1",
      channelId: channel.id,
      sender: { type: "user" },
      content: "Start with the risks.",
    });

    await channels.markMemberSeen(member, 10_000);
    expect((await channels.getMemberBySession("planner-session"))?.seenThrough).toBe(1);
    expect((await channels.getChannel(channel.id))?.seenThrough).toBe(0);
    await channels.markUserSeen(channel.id, 1);
    expect((await channels.getChannel(channel.id))?.seenThrough).toBe(1);

    await channels.appendMessage({
      id: "message-2",
      channelId: channel.id,
      sender: { type: "user" },
      content: "Then propose mitigations.",
    });
    expect((await channels.getMemberBySession("planner-session"))?.seenThrough).toBe(1);
  });

  test("indexes channel artifacts by file identity", async () => {
    const { channels } = await openChannels();
    const channel = await channels.createChannel({ title: "Artifacts" });
    await channels.upsertArtifact({
      channelId: channel.id,
      file: machineFile("/workspace/plan.md"),
      title: "Implementation plan",
    });
    await channels.upsertArtifact({
      channelId: channel.id,
      file: machineFile("/workspace/plan.md"),
      title: "Release plan",
    });
    await channels.upsertArtifact({
      channelId: channel.id,
      file: sessionFile("designer-session", "plan.md"),
      title: "Design plan",
    });

    expect(await channels.listArtifacts(channel.id)).toEqual([
      { file: machineFile("/workspace/plan.md"), title: "Release plan" },
      { file: sessionFile("designer-session", "plan.md"), title: "Design plan" },
    ]);
  });

  test("deleting a member retains sender attribution in prior messages", async () => {
    const { agents, channels } = await openChannels();
    const channel = await channels.createChannel({ title: "Durable log" });
    const agent = await agents.createAgent({ name: "Reviewer" });
    const { member } = await channels.createMember({
      channelId: channel.id,
      agentId: agent.id,
      sessionId: "reviewer-session",
      executionMode: "shared",
    });
    await channels.appendMessage({
      id: "message-1",
      channelId: channel.id,
      sender: {
        type: "agent",
        agentId: agent.id,
      },
      content: "The contract is coherent.",
    });

    expect(await channels.deleteMemberBySession(member.sessionId)).toMatchObject({
      member: { agentId: agent.id, sessionId: "reviewer-session" },
    });
    expect((await channels.listMessages(channel.id))[0]?.sender).toEqual({
      type: "agent",
      agentId: agent.id,
    });
  });
});
