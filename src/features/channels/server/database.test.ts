import { channelAgent, createStoredChannel } from "@channels/server/testFixtures";
import { describe, expect, onTestFinished, test } from "bun:test";
import { machineFile, sessionFile } from "@files/model";
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

describe("channel attention", () => {
  async function setup() {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, { name: "Attention", ...CHANNEL_DEFAULTS });
    const post = (
      content: string,
      sender: { type: "user" } | { type: "agent"; agentId: string } = {
        type: "agent",
        agentId: channel.id,
      },
    ) =>
      channels.appendMessage({
        id: crypto.randomUUID(),
        channelId: channel.id,
        sender,
        content,
      });
    return { channels, channel, post };
  }

  test("completion rejects blockers without changing state and preserves the lead wait", async () => {
    const { channels, channel } = await setup();
    const { member } = await channels.createMember(
      channelAgent(channel.id, "reviewer", "Reviewer"),
    );
    await channels.setAgentStatus(member.id, { state: "waiting", text: "A follow-up" });
    await channels.updateChannel(channel.id, {
      checklist: [{ title: "Release", status: "blocked" }],
    });
    const before = await channels.getState(channel.id, 100);
    await expect(channels.markDone(channel.id)).rejects.toThrow("Cannot mark channel done:");
    expect(await channels.getState(channel.id, 100)).toEqual(before);
    await channels.updateChannel(channel.id, {
      checklist: [{ title: "Release", status: "done" }],
    });
    await expect(channels.markDone(channel.id)).rejects.toThrow("Reviewer is waiting");
    await channels.setAgentStatus(member.id, undefined);
    const lead = await channels.getAgent(channel.id);
    await channels.setAgentStatus(lead!.id, { state: "waiting", text: "The user's next goal" });
    expect((await channels.markDone(channel.id)).channel.hasUnreadCompletion).toBe(true);
    expect((await channels.getAgent(channel.id))?.status?.state).toBe("waiting");
    await expect(channels.markDone(member.id)).rejects.toThrow("Only the channel lead");
  });

  test("a reply between posting and registration already acknowledges the request", async () => {
    const { channels, channel, post } = await setup();
    await post("Choose a name.");
    await post("Juniper.", { type: "user" });
    const notice = await channels.requestUserAttention(channel.id, 1);
    expect(notice.channel.hasPendingRequest).toBe(false);
    expect(notice.message).toMatchObject({
      content: { type: "user_attention_requested", requestSequence: 1 },
    });
    const next = await post("Choose a color.");
    await channels.requestUserAttention(channel.id, next.message.sequence);
    await channels.requestUserAttention(channel.id, 1);
    expect((await channels.getChannel(channel.id))?.hasPendingRequest).toBe(true);
  });

  test("catalog attention includes messages outside the loaded window", async () => {
    const { channels, channel, post } = await setup();
    await channels.markDone(channel.id);
    const request = await post("What should we do next?");
    await channels.requestUserAttention(channel.id, request.message.sequence);
    for (let index = 0; index < 105; index++) await post(`Update ${index}`);
    expect((await channels.getState(channel.id, 100))?.messages).toHaveLength(100);
    expect((await channels.listChannels()).channels[0]).toMatchObject({
      hasUnreadCompletion: true,
      hasPendingRequest: true,
    });
  });

  test("reading acknowledges completion; replying acknowledges a request", async () => {
    const { channels, channel, post } = await setup();
    const done = await channels.markDone(channel.id);
    const request = await post("What should we do next?");
    const notice = await channels.requestUserAttention(channel.id, request.message.sequence);
    const through = notice.message.sequence;
    expect(await channels.markUserSeen(channel.id, through)).toMatchObject({
      hasUnreadCompletion: false,
      hasPendingRequest: true,
    });
    expect(await post("Build the next batch.", { type: "user" })).toMatchObject({
      acknowledgedRequest: true,
      channel: { hasPendingRequest: false },
    });
    expect(
      (await channels.requestUserAttention(channel.id, request.message.sequence)).changed,
    ).toBe(false);
    expect(
      (await channels.listMessagesAfter(channel.id)).filter(
        ({ sender }) => sender.type === "system",
      ),
    ).toEqual([done.message, notice.message]);
    await channels.markDone(channel.id);
    await channels.markUserSeen(channel.id, through);
    expect((await channels.getChannel(channel.id))?.hasUnreadCompletion).toBe(true);
  });

  test("metadata edits preserve attention and equivalent checklist values are unchanged", async () => {
    const { channels, channel, post } = await setup();
    await channels.markDone(channel.id);
    const request = await post("What should we do next?");
    await channels.requestUserAttention(channel.id, request.message.sequence);
    const changes = [
      await channels.editChannel({ channelId: channel.id, name: channel.name }),
      await channels.updateChannel(channel.id, {
        checklist: [{ title: "First outcome", status: "done" }],
      }),
      await channels.updateChannel(channel.id, {
        checklist: [{ status: "done", title: "First outcome" }],
      }),
    ];
    expect(changes.map(({ changed }) => changed)).toEqual([false, true, false]);
    for (const change of changes) {
      expect(change.channel).toMatchObject({
        hasUnreadCompletion: true,
        hasPendingRequest: true,
      });
    }
  });

  test("only the lead can flag agent messages in its own channel", async () => {
    const { channels, channel, post } = await setup();
    const { member } = await channels.createMember(channelAgent(channel.id, "member", "Member"));
    const memberPost = await post("A member question.", { type: "agent", agentId: member.id });
    const userPost = await post("A user question.", { type: "user" });
    for (const sequence of [1, userPost.message.sequence, 999]) {
      await expect(channels.requestUserAttention(channel.id, sequence)).rejects.toThrow(
        "Reference an agent message",
      );
    }
    const leadPost = await post("A lead question.");
    await expect(
      channels.requestUserAttention(member.id, leadPost.message.sequence),
    ).rejects.toThrow("Only the channel lead");
    const other = await createStoredChannel(channels, { name: "Other", ...CHANNEL_DEFAULTS });
    await expect(
      channels.requestUserAttention(other.id, leadPost.message.sequence),
    ).rejects.toThrow("Reference an agent message");
    const attempts = [
      await channels.requestUserAttention(channel.id, leadPost.message.sequence),
      await channels.requestUserAttention(channel.id, leadPost.message.sequence),
    ];
    expect(attempts.map(({ changed }) => changed)).toEqual([true, false]);
    expect(attempts[0]!.message).toEqual(attempts[1]!.message);
    expect(
      (await channels.requestUserAttention(channel.id, memberPost.message.sequence)).message
        .content,
    ).toEqual({ type: "user_attention_requested", requestSequence: memberPost.message.sequence });
  });

  test("a rejected append allocates no sequence number", async () => {
    const { channels, channel, post } = await setup();
    const request = await post("Please approve.");
    await expect(
      channels.appendMessage({
        id: request.message.id,
        channelId: channel.id,
        sender: { type: "user" },
        content: "Approved.",
      }),
    ).rejects.toThrow();
    expect((await post("Next message")).message.sequence).toBe(2);
  });
});

describe("channel database", () => {
  test("stores structural membership and an ordered transcript", async () => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, {
      name: "Release room",
      directory: "/workspace/project",
      ...CHANNEL_DEFAULTS,
    });
    expect((await channels.getState(channel.id, 100))?.lead).toMatchObject({
      id: channel.id,
      name: "Lead",
    });
    expect(await channels.listMembers(channel.id)).toEqual([]);
    const critic = channelAgent(channel.id, "critic-session", "Critic");
    const { member, message: joined } = await channels.createMember(critic);
    await createStoredChannel(channels, { name: "Another room", ...CHANNEL_DEFAULTS });

    const attachments = [
      "/workspace/screenshot.png",
      { mimeType: "image/png", base64: "aW1hZ2U=" },
    ];
    const { message: first } = await channels.appendMessage({
      id: "message-1",
      channelId: channel.id,
      sender: { type: "user" },
      content: "@critic Please check the invitation flow.",
      attachments,
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
    expect(first.attachments).toEqual(attachments);
    expect(await channels.listMembers(channel.id)).toEqual([member]);
    expect((await channels.listChannels()).members).toEqual([member]);
    expect((await channels.getChannel(channel.id))?.latestSequence).toBe(3);
    const messages = await channels.listMessagesAfter(channel.id);
    expect(messages.slice(0, 2)).toEqual([joined, first]);
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
    const channel = await createStoredChannel(channels, {
      name: "Concurrent room",
      ...CHANNEL_DEFAULTS,
    });

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
    const channel = await createStoredChannel(channels, {
      name: "Reaction room",
      ...CHANNEL_DEFAULTS,
    });
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

  test("tracks independent, monotonic human and Agent read positions", async () => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, { name: "Planning", ...CHANNEL_DEFAULTS });
    const { member } = await channels.createMember(
      channelAgent(channel.id, "planner-session", "Planner"),
    );
    await channels.appendMessage({
      id: "message-1",
      channelId: channel.id,
      sender: { type: "user" },
      content: "Start with the risks.",
    });

    await channels.markAgentSeen(member.id, 2);
    expect((await channels.getMember("planner-session"))?.seenThrough).toBe(2);
    expect((await channels.getChannel(channel.id))?.seenThrough).toBe(0);
    await channels.markUserSeen(channel.id, 2);
    expect((await channels.getChannel(channel.id))?.seenThrough).toBe(2);
    await channels.markAgentSeen(member.id, 1);
    await channels.markUserSeen(channel.id, 1);
    expect((await channels.getMember(member.id))?.seenThrough).toBe(2);
    expect((await channels.getChannel(channel.id))?.seenThrough).toBe(2);

    await channels.appendMessage({
      id: "message-2",
      channelId: channel.id,
      sender: { type: "user" },
      content: "Then propose mitigations.",
    });
    expect((await channels.getMember("planner-session"))?.seenThrough).toBe(2);
  });

  test("member edits update the roster without messages and preserve collaboration state", async () => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, {
      name: "Profile room",
      ...CHANNEL_DEFAULTS,
    });
    const { member } = await channels.createMember(
      channelAgent(channel.id, "critic-session", "Critic"),
    );
    const status = { state: "working", text: "Reviewing the direction", workingOn: 1 } as const;
    await channels.markAgentSeen(member.id, 1);
    await channels.setAgentStatus(member.id, status);

    const model = { provider: "copilot", name: "gpt-6", reasoningEffort: "high" };
    const change = await channels.updateMember(member.id, {
      name: "Critic Revised",
      role: "Tests product decisions against user needs.",
      model,
    });

    expect(change).toMatchObject({
      changed: true,
      member: {
        name: "Critic Revised",
        role: "Tests product decisions against user needs.",
        model,
        status,
      },
    });
    expect(await channels.getMember(member.id)).toMatchObject({
      name: "Critic Revised",
      model,
      seenThrough: 1,
      status,
    });
    expect((await channels.listChannels()).members).toEqual([change.member]);
    expect((await channels.listMessagesAfter(channel.id)).map(({ content }) => content)).toEqual([
      { type: "member_joined", member },
    ]);
    const revision = await channels.getRevision(channel.id);
    expect(
      await channels.updateMember(member.id, {
        name: "Critic Revised",
        role: "Tests product decisions against user needs.",
        model: { reasoningEffort: "high", name: "gpt-6", provider: "copilot" },
      }),
    ).toEqual({ changed: false, member: change.member });
    expect(await channels.getRevision(channel.id)).toBe(revision);

    const inherited = await channels.updateMember(member.id, { model: null });
    expect(inherited.member.model).toBeUndefined();
    expect(inherited.member.role).toBe(change.member.role);
    expect((await channels.getChannel(channel.id))?.latestSequence).toBe(1);
  });

  test("rejects a conflicting mention handle without changing the member or channel", async () => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, { name: "Review", ...CHANNEL_DEFAULTS });
    await channels.createMember(channelAgent(channel.id, "reviewer", "Reviewer"));
    const { member } = await channels.createMember(channelAgent(channel.id, "builder", "Builder"));
    const before = await channels.getState(channel.id, 100);

    await expect(
      channels.updateMember(member.id, { name: "Reviewer", role: "New role" }),
    ).rejects.toThrow("already uses the @reviewer mention");

    expect(await channels.getState(channel.id, 100)).toEqual(before);
  });

  test("treats equivalent status values as unchanged", async () => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, {
      name: "Status room",
      ...CHANNEL_DEFAULTS,
    });
    const { member } = await channels.createMember(
      channelAgent(channel.id, "critic-session", "Critic"),
    );
    await channels.setAgentStatus(member.id, {
      state: "working",
      text: "Reviewing the direction",
      workingOn: 1,
    });

    expect(
      await channels.setAgentStatus(member.id, {
        workingOn: 1,
        text: "Reviewing the direction",
        state: "working",
      }),
    ).toBeNull();
  });

  test("records lead name, purpose, and directory changes but keeps checklist and preview quiet", async () => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, {
      name: "Progress room",
      ...CHANNEL_DEFAULTS,
    });
    const { member } = await channels.createMember(
      channelAgent(channel.id, "builder-session", "Builder"),
    );
    const revision = await channels.getRevision(channel.id);

    const update = await channels.updateChannel(channel.id, {
      name: "Delivery room",
      purpose: "Ship and validate the product.",
      directory: "/workspace/delivery",
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
        name: "Delivery room",
        purpose: "Ship and validate the product.",
        directory: "/workspace/delivery",
        checklist: [{ ownerId: member.id }],
        previewUrl: "http://127.0.0.1:3000",
        latestSequence: 4,
      },
    });
    const actor = { type: "agent", agentId: channel.id } as const;
    expect(update.messages.map(({ message }) => message.content)).toEqual([
      { type: "channel_renamed", actor, name: "Delivery room" },
      { type: "channel_purpose_changed", actor, purpose: "Ship and validate the product." },
      { type: "channel_directory_changed", actor, directory: "/workspace/delivery" },
    ]);
    expect(update.messages.map(({ message }) => message.sequence)).toEqual([2, 3, 4]);
    expect(update.messages.map(({ revision }) => revision)).toEqual([
      revision! + 1,
      revision! + 2,
      revision! + 3,
    ]);
    expect(await channels.getRevision(channel.id)).toBe(revision! + 3);
    const previewOnly = await channels.updateChannel(channel.id, {
      previewUrl: "http://127.0.0.1:3100",
    });
    expect(previewOnly.messages).toEqual([]);
    expect(await channels.getRevision(channel.id)).toBe(revision! + 3);
    expect((await channels.getChannel(channel.id))?.latestSequence).toBe(4);
    expect(previewOnly.channel.updatedAt).toBe(update.channel.updatedAt);
    expect(
      (await channels.updateChannel(channel.id, { purpose: null })).channel.purpose,
    ).toBeUndefined();
    expect((await channels.listMessagesAfter(channel.id)).at(-1)?.content).toEqual({
      type: "channel_purpose_changed",
      actor: { type: "agent", agentId: channel.id },
      purpose: null,
    });
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

  test("user edits attribute changes to the user and ignore repeated edits", async () => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, {
      name: "Planning",
      directory: "/workspace/project",
      ...CHANNEL_DEFAULTS,
    });
    const edit = {
      channelId: channel.id,
      purpose: "Work toward a better result.",
      model: { provider: "copilot", name: "gpt-6", reasoningEffort: "high" },
    };
    const changed = await channels.editChannel(edit);
    expect(changed.channel).toMatchObject({
      purpose: edit.purpose,
      model: edit.model,
      directory: channel.directory,
    });
    expect(changed.messages).toMatchObject([{ message: { content: { actor: { type: "user" } } } }]);
    const revision = await channels.getRevision(channel.id);
    expect(await channels.editChannel(edit)).toEqual({
      changed: false,
      channel: changed.channel,
      messages: [],
    });
    expect(await channels.getChannel(channel.id)).toEqual(changed.channel);
    expect(await channels.getRevision(channel.id)).toBe(revision);
  });

  test("rejecting a provider change leaves all channel fields unchanged", async () => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, { name: "Planning", ...CHANNEL_DEFAULTS });
    await expect(
      channels.editChannel({
        channelId: channel.id,
        name: "Rejected name",
        model: { provider: "codex", name: "gpt-6" },
      }),
    ).rejects.toThrow("provider cannot change");
    expect(await channels.getChannel(channel.id)).toEqual(channel);
  });

  test("changing only the lead model does not create unread channel activity", async () => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, { name: "Planning", ...CHANNEL_DEFAULTS });

    const change = await channels.editChannel({
      channelId: channel.id,
      model: { provider: "copilot", name: "gpt-6" },
    });

    expect(change).toMatchObject({ changed: true, channel: { latestSequence: 0 } });
    expect(change.channel.updatedAt).not.toBe(channel.updatedAt);
    expect(change.messages).toEqual([]);
    expect(await channels.getRevision(channel.id)).toBe(0);
    expect(await channels.listMessagesAfter(channel.id)).toEqual([]);
  });

  test("does not repeat unchanged artifact shares", async () => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, { name: "Artifacts", ...CHANNEL_DEFAULTS });
    await channels.shareArtifact({
      channelId: channel.id,
      file: machineFile("/workspace/plan.md"),
      title: "Implementation plan",
      actor: { type: "user" },
    });
    await channels.shareArtifact({
      channelId: channel.id,
      file: machineFile("/workspace/plan.md"),
      title: "Release plan",
      actor: { type: "user" },
    });
    const revision = await channels.getRevision(channel.id);
    await channels.shareArtifact({
      channelId: channel.id,
      file: machineFile("/workspace/plan.md"),
      title: "Release plan",
      actor: { type: "user" },
    });
    expect(await channels.getRevision(channel.id)).toBe(revision);
    await channels.shareArtifact({
      channelId: channel.id,
      file: sessionFile("designer-session", "plan.md"),
      title: "Design plan",
      actor: { type: "user" },
    });

    expect(await channels.listArtifacts(channel.id)).toEqual([
      {
        file: machineFile("/workspace/plan.md"),
        title: "Release plan",
        sharedAt: expect.any(String),
      },
      {
        file: sessionFile("designer-session", "plan.md"),
        title: "Design plan",
        sharedAt: expect.any(String),
      },
    ]);
    expect((await channels.getState(channel.id, 100))?.messages).toHaveLength(3);
  });

  test("deleting a member retains sender attribution in prior messages", async () => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, {
      name: "Durable log",
      ...CHANNEL_DEFAULTS,
    });
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
