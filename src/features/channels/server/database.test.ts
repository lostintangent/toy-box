import { channelAgent, createStoredChannel } from "@channels/server/testFixtures";
import { describe, expect, onTestFinished, setSystemTime, test } from "bun:test";
import type { ChannelTask } from "@channels/model";
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
    /** Reopens one task, then completes the list, returning the completion message. */
    const complete = async (title = "Release") => {
      await channels.updateChannel(channel.id, { tasks: [{ title, status: "pending" }] });
      const { events } = await channels.updateChannel(channel.id, {
        tasks: [{ title, status: "done" }],
      });
      return events.find((event) => event.type === "message")!.message;
    };
    /** Sends a lead message flagged as a user request, returning the question. */
    const ask = async (content: string) => {
      const { events } = await channels.appendMessage({
        id: crypto.randomUUID(),
        channelId: channel.id,
        sender: { type: "agent", agentId: channel.id },
        content,
        request: true,
      });
      return events[0]!.message;
    };
    return { channels, channel, post, complete, ask };
  }

  test("rewriting a complete list never repeats completion; reopening a task does", async () => {
    const { channels, channel } = await setup();
    const update = async (tasks: ChannelTask[]) =>
      (await channels.updateChannel(channel.id, { tasks })).events.filter(
        (event) => event.type === "message",
      ).length;
    const release = { title: "Release", status: "done" } as const;
    expect(await update([release])).toBe(1);
    expect((await channels.getChannel(channel.id))?.completedSequence).toBe(1);
    expect(await update([release, { title: "Notes", status: "done" }])).toBe(0);
    expect(await update([release, { title: "Ship", status: "pending" }])).toBe(0);
    expect(await update([release, { title: "Ship", status: "done" }])).toBe(1);
    expect(await update([])).toBe(0);
  });

  test("a request persists on the lead message without an extra transcript entry", async () => {
    const { channels, channel, ask } = await setup();
    const question = await ask("Choose a name.");
    expect(question).toMatchObject({ sequence: 1, content: "Choose a name.", request: true });
    expect(await channels.listMessagesAfter(channel.id)).toEqual([question]);
    expect((await channels.getChannel(channel.id))?.requestSequence).toBe(1);
  });

  test("catalog attention includes messages outside the loaded window", async () => {
    const { channels, channel, post, complete, ask } = await setup();
    await complete();
    await ask("What should we do next?");
    for (let index = 0; index < 105; index++) await post(`Update ${index}`);
    const snapshot = await channels.getSnapshot(channel.id, 100);
    expect(snapshot?.messages).toHaveLength(100);
    expect(snapshot?.request).toMatchObject({ content: "What should we do next?" });
    expect((await channels.listChannels()).channels[0]).toMatchObject({
      completedSequence: 1,
      requestSequence: 2,
    });
    await ask("Which follow-up should we prioritize?");
    expect((await channels.getSnapshot(channel.id, 1))?.request).toMatchObject({
      content: "Which follow-up should we prioritize?",
    });
  });

  test("reads and replies persist attention cursors with their receipts", async () => {
    const { channels, channel, post, complete, ask } = await setup();
    const done = await complete();
    const question = await ask("What should we do next?");
    const through = question.sequence;
    expect(await channels.markUserSeen(channel.id, through)).toMatchObject({
      channel: { completedSequence: done.sequence, requestSequence: question.sequence },
      events: [{ type: "read", seenThrough: through }],
    });
    const reply = await post("Build the next batch.", { type: "user" });
    expect(reply).toMatchObject({
      acknowledgedRequest: true,
      channel: { requestSequence: null },
    });
    expect(reply.channel).toEqual((await channels.getChannel(channel.id))!);
    expect((await channels.getSnapshot(channel.id, 1))?.request).toBeNull();
    expect(
      (await channels.listMessagesAfter(channel.id)).filter(
        ({ sender }) => sender.type === "system",
      ),
    ).toEqual([done]);
  });

  test("only the lead can request input", async () => {
    const { channels, channel } = await setup();
    const { member } = await channels.createMember(channelAgent(channel.id, "member", "Member"));
    const other = await createStoredChannel(channels, { name: "Other", ...CHANNEL_DEFAULTS });
    const senders = [
      { type: "user" },
      { type: "agent", agentId: member.id },
      { type: "agent", agentId: other.id },
    ] as const;
    for (const sender of senders) {
      await expect(
        channels.appendMessage({
          id: crypto.randomUUID(),
          channelId: channel.id,
          sender,
          content: "Which color?",
          request: true,
        }),
      ).rejects.toThrow("Only the channel lead can request input.");
    }
    expect((await channels.getChannel(channel.id))?.latestSequence).toBe(1);
  });

  test("a rejected reply preserves attention and allocates no sequence number", async () => {
    const { channels, channel, post, ask } = await setup();
    const request = await ask("Please approve.");
    const before = await channels.getSnapshot(channel.id, 100);
    await expect(
      channels.appendMessage({
        id: request.id,
        channelId: channel.id,
        sender: { type: "user" },
        content: "Approved.",
      }),
    ).rejects.toThrow();
    expect(await channels.getSnapshot(channel.id, 100)).toEqual(before);
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
    expect((await channels.getSnapshot(channel.id, 100))?.lead).toMatchObject({
      id: channel.id,
      name: "Lead",
    });
    expect(await channels.listMembers(channel.id)).toEqual([]);
    const critic = channelAgent(channel.id, "critic-session", "Critic");
    const {
      member,
      events: [joinedEvent],
    } = await channels.createMember(critic);
    const joined = joinedEvent!.message;
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
    const second = await channels.appendMessage({
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
    expect(second.channel).toEqual((await channels.getChannel(channel.id))!);
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
    expect(changes.flatMap(({ events }) => events.map(({ revision }) => revision))).toEqual(
      expectedSequences,
    );
    expect((await channels.getChannel(channel.id))?.latestSequence).toBe(12);
    expect((await channels.listMessagesAfter(channel.id)).map(({ sequence }) => sequence)).toEqual(
      expectedSequences,
    );
  });

  test("sets and clears one reaction per Agent without changing Channel metadata", async () => {
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
    expect(await channels.markUserSeen(channel.id, 100)).toMatchObject({
      events: [{ type: "read", revision: 3, seenThrough: 2 }],
    });
    expect((await channels.getChannel(channel.id))?.seenThrough).toBe(2);
    await channels.markAgentSeen(member.id, 1);
    expect(await channels.markUserSeen(channel.id, 1)).toBeNull();
    expect((await channels.getRoster(channel.id))?.revision).toBe(3);
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
    expect((await channels.listChannels()).members).toEqual([
      { id: change.member.id, channelId: channel.id, name: "Critic Revised" },
    ]);
    expect((await channels.listMessagesAfter(channel.id)).map(({ content }) => content)).toEqual([
      { type: "member_joined", member },
    ]);
    const revision = (await channels.getRoster(channel.id))?.revision;
    expect(
      await channels.updateMember(member.id, {
        name: "Critic Revised",
        role: "Tests product decisions against user needs.",
        model: { reasoningEffort: "high", name: "gpt-6", provider: "copilot" },
      }),
    ).toEqual({ channelId: channel.id, events: [], member: change.member });
    expect((await channels.getRoster(channel.id))?.revision).toBe(revision);

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
    const before = await channels.getSnapshot(channel.id, 100);

    await expect(
      channels.updateMember(member.id, { name: "Reviewer", role: "New role" }),
    ).rejects.toThrow("already uses the @reviewer mention");

    expect(await channels.getSnapshot(channel.id, 100)).toEqual(before);
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

  test("records metadata and preview messages while task revisions remain quiet", async () => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, {
      name: "Progress room",
      ...CHANNEL_DEFAULTS,
    });
    const { member } = await channels.createMember(
      channelAgent(channel.id, "builder-session", "Builder"),
    );
    const revision = (await channels.getRoster(channel.id))?.revision;

    const update = await channels.updateChannel(channel.id, {
      name: "Delivery room",
      purpose: "Ship and validate the product.",
      directory: "/workspace/delivery",
      tasks: [
        {
          title: "Build the product",
          status: "in_progress",
          ownerId: member.id,
          children: [{ title: "Verify the preview", status: "pending" }],
        },
      ],
      previewUrl: "http://127.0.0.1:3000",
    });

    const actor = { type: "agent", agentId: channel.id } as const;
    const messages = update.events.filter((event) => event.type === "message");
    expect(messages.map(({ message }) => message.content)).toEqual([
      { type: "channel_renamed", actor, name: "Delivery room" },
      { type: "channel_purpose_changed", actor, purpose: "Ship and validate the product." },
      { type: "channel_directory_changed", actor, directory: "/workspace/delivery" },
      { type: "preview_changed", actor, previewUrl: "http://127.0.0.1:3000" },
    ]);
    expect(messages.map(({ message }) => message.sequence)).toEqual([2, 3, 4, 5]);
    expect(update.events[0]).toEqual({
      type: "tasks",
      revision: revision! + 1,
      tasks: update.channel.tasks,
    });
    expect(messages.map(({ revision }) => revision)).toEqual(
      [2, 3, 4, 5].map((offset) => revision! + offset),
    );
    expect((await channels.getRoster(channel.id))?.revision).toBe(revision! + 5);
    expect(await channels.getChannel(channel.id)).toEqual(update.channel);
    const cleared = await channels.updateChannel(channel.id, { previewUrl: null });
    expect(cleared.events).toMatchObject([
      {
        type: "message",
        revision: revision! + 6,
        message: { content: { type: "preview_changed", actor, previewUrl: null } },
      },
    ]);
    expect(cleared.channel.previewUrl).toBeUndefined();
    expect(await channels.getChannel(channel.id)).toEqual(cleared.channel);
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
        tasks: [{ title: "Take over", status: "pending" }],
      }),
    ).rejects.toThrow("Only the channel lead");

    await channels.deleteMember(member.id);
    expect((await channels.getChannel(channel.id))?.tasks).toEqual([
      {
        title: "Build the product",
        status: "in_progress",
        children: [{ title: "Verify the preview", status: "pending" }],
      },
    ]);
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

    expect(change).toMatchObject({ channel: { latestSequence: 0 } });
    expect(change.channel.updatedAt).not.toBe(channel.updatedAt);
    expect(change.events).toEqual([
      {
        type: "model",
        revision: 1,
        model: change.channel.model,
        updatedAt: change.channel.updatedAt,
      },
    ]);
    expect((await channels.getRoster(channel.id))?.revision).toBe(1);
    expect(await channels.getChannel(channel.id)).toEqual(change.channel);
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
    const revision = (await channels.getRoster(channel.id))?.revision;
    await channels.shareArtifact({
      channelId: channel.id,
      file: machineFile("/workspace/plan.md"),
      title: "Release plan",
      actor: { type: "user" },
    });
    expect((await channels.getRoster(channel.id))?.revision).toBe(revision);
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
    expect((await channels.getSnapshot(channel.id, 100))?.messages).toHaveLength(3);
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

describe("channel routines", () => {
  async function setup() {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, { name: "Watch", ...CHANNEL_DEFAULTS });
    return { channels, channel };
  }

  /** A local wall-clock time, so hourly cron boundaries hold in any time zone. */
  function localTime(hours: number, minutes = 0): Date {
    return new Date(2026, 8, 29, hours, minutes);
  }

  test("a lead adds, changes, and deletes routines with one transcript message each", async () => {
    const { channels, channel } = await setup();
    const standup = await channels.setRoutine(channel.id, {
      title: "CI",
      schedule: "0 9 * * 1-5",
      prompt: "Check CI",
    });
    const review = await channels.setRoutine(channel.id, {
      title: "Review",
      schedule: "0 16 * * 5",
      prompt: "Review the week",
    });
    const changed = await channels.setRoutine(channel.id, {
      routineId: standup.routine.id,
      title: "CI",
      schedule: "0 9 * * 1-5",
      prompt: "Check CI and new issues",
    });
    await channels.deleteRoutine(channel.id, review.routine.id);

    expect((await channels.listMessagesAfter(channel.id)).map(({ content }) => content)).toEqual([
      { type: "routine_scheduled", routine: standup.routine },
      { type: "routine_scheduled", routine: review.routine },
      { type: "routine_edited", routine: changed.routine },
      { type: "routine_deleted", routine: review.routine },
    ]);
    expect((await channels.getSnapshot(channel.id, 100))?.routines).toEqual([changed.routine]);
  });

  test("an identical change and a repeated deletion leave the transcript alone", async () => {
    const { channels, channel } = await setup();
    const input = { title: "CI", schedule: "0 9 * * *", prompt: "Check CI" };
    const { routine } = await channels.setRoutine(channel.id, input);
    const unchanged = await channels.setRoutine(channel.id, { routineId: routine.id, ...input });
    await channels.deleteRoutine(channel.id, routine.id);

    expect(unchanged.events).toEqual([]);
    expect(await channels.deleteRoutine(channel.id, routine.id)).toBeNull();
    expect((await channels.getChannel(channel.id))?.latestSequence).toBe(2);
  });

  test("routine edits require the channel lead and an existing routine", async () => {
    const { channels, channel } = await setup();
    const { member } = await channels.createMember(channelAgent(channel.id, "watcher", "Watcher"));
    const routine = { title: "CI", schedule: "0 9 * * *", prompt: "Check CI" };

    await expect(channels.setRoutine(member.id, routine)).rejects.toThrow("Only the channel lead");
    await expect(
      channels.setRoutine(channel.id, { ...routine, routineId: "missing" }),
    ).rejects.toThrow("Routine not found");
  });

  test("a due routine is claimed once, and runs missed while stopped collapse into one", async () => {
    const { channels, channel } = await setup();
    setSystemTime(localTime(10, 30));
    onTestFinished(() => setSystemTime());
    await channels.setRoutine(channel.id, {
      title: "CI",
      schedule: "0 * * * *",
      prompt: "Check CI",
    });
    const due = [{ channelId: channel.id, title: "CI", prompt: "Check CI" }];

    expect((await channels.claimDueWakes(localTime(10, 59))).routines).toEqual([]);
    expect((await channels.claimDueWakes(localTime(14, 10))).routines).toEqual(due);
    expect((await channels.claimDueWakes(localTime(14, 10))).routines).toEqual([]);
    expect((await channels.claimDueWakes(localTime(15))).routines).toEqual(due);
  });
});
