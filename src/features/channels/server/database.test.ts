import { describe, expect, onTestFinished, test } from "bun:test";
import { machineFile, sessionFile } from "@files/model";
import type { Worker } from "@workers/model";
import { createTestDatabase } from "@/server/database";
import { ChannelDatabase } from "./database";

const CHANNEL_DEFAULTS = {
  purpose: "Coordinate the work to a useful result.",
  model: { provider: "copilot", name: "gpt-5.5" },
} as const;

async function openChannels() {
  const database = await createTestDatabase();
  onTestFinished(() => database.close());
  return new ChannelDatabase(database);
}

function channelAgent(
  channelId: string,
  sessionId: string,
  name: string,
): Extract<Worker, { type: "channel" }> {
  return {
    type: "channel",
    channelId,
    sessionId,
    ephemeral: false,
    name,
    metadata: { seenThrough: 0 },
  };
}

describe("channel database", () => {
  test("stores structural membership and an ordered transcript", async () => {
    const channels = await openChannels();
    const channel = await channels.createChannel({
      name: "Release room",
      directory: "/workspace/project",
      ...CHANNEL_DEFAULTS,
    });
    expect((await channels.getState(channel.id, 100))?.lead).toMatchObject({
      id: channel.leadId,
      name: "Lead",
    });
    expect(await channels.listMembers(channel.id)).toEqual([]);
    const critic = channelAgent(channel.id, "critic-session", "Critic");
    const { member } = await channels.createMember(critic);
    await channels.createChannel({ name: "Another room", ...CHANNEL_DEFAULTS });

    const { message: first } = await channels.appendMessage({
      id: "message-1",
      channelId: channel.id,
      sender: { type: "user" },
      content: "@critic Please check the invitation flow.",
      attachments: [{ mimeType: "image/png", base64: "aW1hZ2U=" }],
    });
    await channels.appendMessage({
      id: "message-2",
      channelId: channel.id,
      sender: {
        type: "agent",
        agentId: critic.sessionId,
      },
      content: "The empty state is clear.",
    });

    expect(first.sequence).toBe(2);
    expect(await channels.listMembers(channel.id)).toEqual([member]);
    expect((await channels.listChannels()).members).toEqual([member]);
    expect((await channels.getChannel(channel.id))?.latestSequence).toBe(3);
    const messages = await channels.listMessagesAfter(channel.id);
    expect(messages[1]?.attachments).toEqual(first.attachments);
    expect(messages.map(({ sender, content }) => ({ sender, content }))).toEqual([
      {
        sender: { type: "system" },
        content: { type: "member_joined", member },
      },
      {
        sender: { type: "user" },
        content: "@critic Please check the invitation flow.",
      },
      {
        sender: { type: "agent", agentId: critic.sessionId },
        content: "The empty state is clear.",
      },
    ]);
    expect(
      (await channels.listMessagesBefore(channel.id, undefined, 2)).map(({ sequence }) => sequence),
    ).toEqual([2, 3]);
    expect(
      (await channels.listMessagesBefore(channel.id, 3, 2)).map(({ sequence }) => sequence),
    ).toEqual([1, 2]);
  });

  test("serializes concurrent writers on the shared SQLite connection", async () => {
    const channels = await openChannels();
    const channel = await channels.createChannel({ name: "Concurrent room", ...CHANNEL_DEFAULTS });

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
    expect(changes.map(({ revision }) => revision)).toEqual(expectedSequences);
    expect((await channels.getChannel(channel.id))?.latestSequence).toBe(12);
    expect((await channels.listMessagesAfter(channel.id)).map(({ sequence }) => sequence)).toEqual(
      expectedSequences,
    );
  });

  test("sets and clears one current reaction per Agent without advancing transcript state", async () => {
    const channels = await openChannels();
    const channel = await channels.createChannel({ name: "Reaction room", ...CHANNEL_DEFAULTS });
    const reviewerId = "reviewer-session";
    const designerId = "designer-session";
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
        agentId: reviewerId,
        reaction: "love",
      }),
      channels.setMessageReaction({
        channelId: channel.id,
        sequence: 1,
        agentId: designerId,
        reaction: "done",
      }),
    ]);
    await channels.setMessageReaction({
      channelId: channel.id,
      sequence: 1,
      agentId: reviewerId,
      reaction: "agree",
    });

    const reactions = (await channels.listMessagesAfter(channel.id))[0]?.reactions;
    expect(reactions).toHaveLength(2);
    expect(reactions).toEqual(
      expect.arrayContaining([
        { agentId: designerId, reaction: "done" },
        { agentId: reviewerId, reaction: "agree" },
      ]),
    );
    await channels.setMessageReaction({
      channelId: channel.id,
      sequence: 1,
      agentId: reviewerId,
      reaction: null,
    });
    await channels.setMessageReaction({
      channelId: channel.id,
      sequence: 1,
      agentId: reviewerId,
      reaction: null,
    });
    expect((await channels.listMessagesAfter(channel.id))[0]?.reactions).toEqual([
      { agentId: designerId, reaction: "done" },
    ]);
    expect(await channels.getChannel(channel.id)).toEqual(channelBeforeReactions);
  });

  test("tracks independent human and Agent read positions", async () => {
    const channels = await openChannels();
    const channel = await channels.createChannel({ name: "Planning", ...CHANNEL_DEFAULTS });
    const { member } = await channels.createMember(
      channelAgent(channel.id, "planner-session", "Planner"),
    );
    await channels.appendMessage({
      id: "message-1",
      channelId: channel.id,
      sender: { type: "user" },
      content: "Start with the risks.",
    });

    await channels.markAgentSeen(member, 2);
    expect((await channels.getMember("planner-session"))?.seenThrough).toBe(2);
    expect((await channels.getChannel(channel.id))?.seenThrough).toBe(0);
    await channels.markUserSeen(channel.id, 2);
    expect((await channels.getChannel(channel.id))?.seenThrough).toBe(2);

    await channels.appendMessage({
      id: "message-2",
      channelId: channel.id,
      sender: { type: "user" },
      content: "Then propose mitigations.",
    });
    expect((await channels.getMember("planner-session"))?.seenThrough).toBe(2);
  });

  test("profile updates preserve collaboration state", async () => {
    const channels = await openChannels();
    const channel = await channels.createChannel({ name: "Profile room", ...CHANNEL_DEFAULTS });
    const { member } = await channels.createMember(
      channelAgent(channel.id, "critic-session", "Critic"),
    );
    const status = { state: "working", text: "Reviewing the direction", workingOn: 1 } as const;
    await channels.markAgentSeen(member, 1);
    await channels.setAgentStatus(member, status);

    const change = await channels.updateMember(member.id, {
      role: "Tests product decisions against user needs.",
    });

    expect(change.member).toMatchObject({ role: expect.any(String), status });
    expect(await channels.getMember(member.id)).toMatchObject({ seenThrough: 1, status });
  });

  test("treats equivalent status values as unchanged", async () => {
    const channels = await openChannels();
    const channel = await channels.createChannel({ name: "Status room", ...CHANNEL_DEFAULTS });
    const { member } = await channels.createMember(
      channelAgent(channel.id, "critic-session", "Critic"),
    );
    await channels.setAgentStatus(member, {
      state: "working",
      text: "Reviewing the direction",
      workingOn: 1,
    });

    expect(
      await channels.setAgentStatus(member, {
        workingOn: 1,
        text: "Reviewing the direction",
        state: "working",
      }),
    ).toBeNull();
  });

  test("lets the lead maintain the channel without advancing the transcript", async () => {
    const channels = await openChannels();
    const channel = await channels.createChannel({ name: "Progress room", ...CHANNEL_DEFAULTS });
    const { member } = await channels.createMember(
      channelAgent(channel.id, "builder-session", "Builder"),
    );
    const revision = await channels.getRevision(channel.id);

    const update = await channels.updateChannel(channel.leadId, {
      purpose: "Ship and validate the product.",
      checklist: [
        {
          title: "Build the product",
          status: "in_progress",
          ownerId: member.id,
          children: [{ title: "Verify the preview", status: "pending" }],
        },
      ],
      previewUrl: "http://127.0.0.1:3000",
    });

    expect(update).toMatchObject({
      changed: true,
      channel: {
        purpose: "Ship and validate the product.",
        checklist: [{ ownerId: member.id }],
        previewUrl: "http://127.0.0.1:3000",
        latestSequence: 1,
      },
    });
    expect(await channels.getRevision(channel.id)).toBe(revision);
    expect(
      (await channels.updateChannel(channel.leadId, { purpose: null })).channel.purpose,
    ).toBeUndefined();
    await expect(
      channels.updateChannel(member.id, {
        checklist: [{ title: "Take over", status: "pending" }],
      }),
    ).rejects.toThrow("Only the channel lead");

    await channels.deleteMember(member.id);
    expect((await channels.getChannel(channel.id))?.checklist).toEqual([
      {
        title: "Build the product",
        status: "in_progress",
        children: [{ title: "Verify the preview", status: "pending" }],
      },
    ]);
  });

  test("does not repeat unchanged artifact shares", async () => {
    const channels = await openChannels();
    const channel = await channels.createChannel({ name: "Artifacts", ...CHANNEL_DEFAULTS });
    await channels.shareArtifact({
      id: "share-1",
      channelId: channel.id,
      file: machineFile("/workspace/plan.md"),
      title: "Implementation plan",
      actor: { type: "user" },
    });
    await channels.shareArtifact({
      id: "share-2",
      channelId: channel.id,
      file: machineFile("/workspace/plan.md"),
      title: "Release plan",
      actor: { type: "user" },
    });
    const revision = await channels.getRevision(channel.id);
    await channels.shareArtifact({
      id: "share-3",
      channelId: channel.id,
      file: machineFile("/workspace/plan.md"),
      title: "Release plan",
      actor: { type: "user" },
    });
    expect(await channels.getRevision(channel.id)).toBe(revision);
    await channels.shareArtifact({
      id: "share-4",
      channelId: channel.id,
      file: sessionFile("designer-session", "plan.md"),
      title: "Design plan",
      actor: { type: "user" },
    });

    expect(await channels.listArtifacts(channel.id)).toEqual([
      { file: machineFile("/workspace/plan.md"), title: "Release plan" },
      {
        file: sessionFile("designer-session", "plan.md"),
        title: "Design plan",
      },
    ]);
    expect((await channels.getState(channel.id, 100))?.messages).toHaveLength(3);
  });

  test("deleting a member retains sender attribution in prior messages", async () => {
    const channels = await openChannels();
    const channel = await channels.createChannel({ name: "Durable log", ...CHANNEL_DEFAULTS });
    const { member } = await channels.createMember(
      channelAgent(channel.id, "reviewer-session", "Reviewer"),
    );
    await channels.appendMessage({
      id: "message-1",
      channelId: channel.id,
      sender: {
        type: "agent",
        agentId: member.id,
      },
      content: "The contract is coherent.",
    });

    expect(await channels.deleteMember(member.id)).toMatchObject({
      member: { id: member.id, name: "Reviewer" },
    });
    const messages = await channels.listMessagesAfter(channel.id);
    expect(messages.find(({ id }) => id === "message-1")?.sender).toEqual({
      type: "agent",
      agentId: member.id,
    });
    expect(messages.at(-1)?.content).toEqual({ type: "member_left", member });
  });
});
