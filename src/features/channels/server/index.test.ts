import { getChannelSnapshot } from "./stream";
import { channelAgent, createStoredChannel } from "@channels/server/testFixtures";
import { beforeEach, expect, mock, onTestFinished, setSystemTime, spyOn, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelEvent } from "@channels/model";
import { machineFile, workspaceFileId } from "@files/model";
import { reduceChannelState } from "@channels/model/reducer";
import { createTestDatabase } from "@/server/database";
import { detachManagedSession } from "@/server/managedSessions";
import * as sessions from "@sessions/server/providers";
import * as sessionRuntime from "@sessions/server/runtime";
import { normalizeToolResult, type Tool } from "@sessions/server/tools/definition";
import * as workspaceEvents from "@workspace/server/events";
import { setSessionStatus } from "@workspace/server/state";
import { deleteSessionState } from "@workspace/server/state/sessions";
import startChannels from "./startup";

let currentDb: Bun.SQL | undefined;

mock.module("@/server/database", () => ({
  getStateDatabase: async () => {
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const { ChannelDatabase } = await import("./database");
const {
  createChannel,
  deleteChannel,
  createChannelMember,
  createChannelMembersFromLead,
  editChannel,
  editChannelTasksFromLead,
  finishChannelAgentTurn,
  markChannelRead,
  postChannelMessageFromSession,
  readChannelForSession,
  runChannelRoutine,
  sendChannelMessageFromAgent,
  setChannelAgentStatus,
  setChannelMessageReactionFromAgent,
  setChannelRoutineFromLead,
  updateChannelMember,
  updateChannelFromLead,
  wakeDueChannelAgents,
} = await import("./index");
const { subscribeChannelEvents, releaseChannelEvents } = await import("./events");
const { channelLeadTools, channelMemberTools, channelTools, createChannelMembersTool } =
  await import("./tools");

beforeEach(() => {
  const create = spyOn(sessionRuntime, "createSession").mockResolvedValue({
    disposition: "started",
    waitForCompletion: async () => ({ status: "completed" }),
  });
  onTestFinished(() => create.mockRestore());
});

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const CHANNEL_DEFAULTS = {
  purpose: "Coordinate the work to a useful result.",
  model: { provider: "copilot", name: "gpt-5.5" },
} as const;

async function openChannels() {
  const database = await createTestDatabase();
  currentDb = database;
  onTestFinished(async () => {
    await database.close();
    currentDb = undefined;
  });
  return new ChannelDatabase(database);
}

async function invokeTool(name: string, input = {}, sessionId = "coordinator") {
  const tool = [
    ...channelTools,
    createChannelMembersTool,
    ...channelMemberTools,
    ...channelLeadTools,
  ].find((tool) => tool.name === name) as Tool | undefined;
  if (!tool) throw new Error(`Tool not found: ${name}`);
  const result = normalizeToolResult(
    await tool.handler(tool.parameters?.parse(input) ?? input, {
      sessionId,
      toolCallId: name,
      toolName: name,
      arguments: input,
    }),
  );
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("Expected a text tool result.");
  return JSON.parse(content.text);
}

test("attention uses normal messages and upserts, and a user reply also wakes the lead", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Attention", ...CHANNEL_DEFAULTS });
  const { member } = await channels.createMember(channelAgent(channel.id, "builder", "Builder"));
  const events: ChannelEvent[] = [];
  const unsubscribe = subscribeChannelEvents(channel.id, (event) => events.push(event));
  const broadcasts = spyOn(workspaceEvents, "broadcast").mockImplementation(() => {});
  const deliver = spyOn(sessionRuntime, "deliverSessionMessage").mockResolvedValue({
    disposition: "started",
    waitForCompletion: async () => ({ status: "completed" }),
  });
  onTestFinished(async () => {
    unsubscribe();
    releaseChannelEvents(channel.id);
    broadcasts.mockRestore();
    deliver.mockRestore();
  });

  await setChannelAgentStatus(channel.id, { status: "Finishing" });
  const request = await sendChannelMessageFromAgent(channel.id, {
    content: "Choose the next task.",
    request: true,
  });
  await updateChannelFromLead(channel.id, {
    tasks: [{ id: "ship", title: "Ship", status: "done" }],
  });
  expect(
    events.filter((event) => event.type === "message").map(({ message }) => message.content),
  ).toEqual([request.content, { type: "tasks_completed" }]);
  expect(broadcasts.mock.calls.map(([event]) => event.type)).toEqual([
    "channel.upserted",
    "channel.upserted",
  ]);
  expect(broadcasts.mock.lastCall?.[0]).toMatchObject({
    channel: { requestSequence: expect.any(Number), completedSequence: expect.any(Number) },
  });
  expect(deliver).not.toHaveBeenCalled();
  expect((await channels.getAgent(channel.id))?.status?.state).toBe("working");
  await finishChannelAgentTurn(channel.id, "Your color choice");
  await postChannelMessageFromSession("user-session", {
    id: "decision",
    channelId: channel.id,
    content: "@builder use blue.",
  });
  expect(deliver.mock.calls.map(([id]) => id).sort()).toEqual([channel.id, member.id].sort());
  expect((await channels.getChannel(channel.id))?.requestSequence).toBeNull();
  expect((await channels.getAgent(channel.id))?.status).toBeUndefined();
});

test("creating a Channel starts its lead without creating a directory", async () => {
  await openChannels();
  const root = await mkdtemp(join(tmpdir(), "toy-box-channel-create-"));
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const directory = join(root, "nested", "workspace");
  const leadStarted = Promise.withResolvers<Parameters<typeof sessionRuntime.createSession>>();
  const create = spyOn(sessionRuntime, "createSession").mockImplementation(async (...args) => {
    leadStarted.resolve(args);
    return {
      disposition: "started",
      waitForCompletion: async () => ({ status: "completed" }),
    };
  });
  onTestFinished(() => create.mockRestore());

  const channel = await createChannel({
    name: "Bitmap studio",
    directory,
    model: CHANNEL_DEFAULTS.model,
  });
  const [leadId, message, options] = await leadStarted.promise;

  expect(channel.directory).toBe(directory);
  expect(channel.purpose).toBeUndefined();
  await expect(stat(directory)).rejects.toThrow();
  expect(leadId).toBe(channel.id);
  expect(message).toMatchObject({
    content: "This channel was just created. Begin working toward its purpose.",
  });
  expect(options).toMatchObject({
    sessionType: "worker",
    name: "Lead · Bitmap studio",
  });
});

test.each([false, true])(
  "channel deletion publishes once and attempts all session cleanup (failure=%s)",
  async (failCleanup) => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, { name: "Delete", ...CHANNEL_DEFAULTS });
    await channels.createMember(channelAgent(channel.id, "builder", "Builder"));
    await channels.createMember(channelAgent(channel.id, "reviewer", "Reviewer"));
    const agentIds = await channels.listAgentIds(channel.id);
    const observed: unknown[] = [];
    onTestFinished(subscribeChannelEvents(channel.id, (event) => observed.push(event)));
    const broadcasts = spyOn(workspaceEvents, "broadcast").mockImplementation((event) => {
      observed.push(event);
    });
    const cleanup = spyOn(sessionRuntime, "deleteSessionIfExists").mockImplementation(
      async (id) => {
        observed.push(id);
        await detachManagedSession(id);
        if (failCleanup && id === "builder") throw new Error("Provider cleanup failed");
        return true;
      },
    );
    onTestFinished(() => {
      cleanup.mockRestore();
      broadcasts.mockRestore();
    });

    const deletion = deleteChannel(channel.id);
    if (failCleanup)
      await expect(deletion).rejects.toThrow("Channel deleted; agent cleanup failed.");
    else expect(await deletion).toBe(true);
    expect(await deleteChannel(channel.id)).toBe(false);
    expect(await channels.getChannel(channel.id)).toBeNull();
    expect(await channels.listAgentIds(channel.id)).toEqual([]);
    expect(observed[0]).toEqual({ type: "channel.deleted", channelId: channel.id });
    expect(observed.slice(1)).toEqual(expect.arrayContaining(agentIds));
    expect(observed).toHaveLength(agentIds.length + 1);
  },
);

test("an addressed post settles after its Agent wake is ready and a duplicate never delivers", async () => {
  const channels = await openChannels();

  const channel = await createStoredChannel(channels, {
    name: "Coordination",
    ...CHANNEL_DEFAULTS,
  });
  const { member } = await channels.createMember(
    channelAgent(channel.id, "reviewer-session", "Reviewer"),
  );
  await channels.setAgentStatus(member.id, { state: "waiting", text: "a review request" });
  let releaseWake!: () => void;
  let announceWake!: () => void;
  const wakeStarted = new Promise<void>((resolve) => {
    announceWake = resolve;
  });
  const wakeFinished = new Promise<void>((resolve) => {
    releaseWake = resolve;
  });
  const deliver = spyOn(sessionRuntime, "deliverSessionMessage").mockImplementation(async () => {
    announceWake();
    await wakeFinished;
    return {
      disposition: "queued",
      waitForCompletion: async () => ({ status: "completed" }),
    };
  });
  onTestFinished(() => deliver.mockRestore());

  let settled = false;
  const input = {
    id: "review-request",
    channelId: channel.id,
    content: "@reviewer please inspect this.",
  };
  const post = postChannelMessageFromSession("coordinator-session", input).then(() => {
    settled = true;
  });
  await wakeStarted;
  expect(settled).toBe(false);
  releaseWake();
  await post;
  expect((await channels.getMember(member.id))?.status).toBeUndefined();
  await expect(postChannelMessageFromSession("coordinator-session", input)).rejects.toThrow();
  expect(deliver).toHaveBeenCalledTimes(1);
  expect((await channels.getChannel(channel.id))?.latestSequence).toBe(2);
});

test("an Agent can attach an image file to a durable Channel message", async () => {
  const channels = await openChannels();
  const directory = await mkdtemp(join(tmpdir(), "toy-box-channel-message-"));
  onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const channel = await createStoredChannel(channels, {
    name: "Visual review",
    ...CHANNEL_DEFAULTS,
  });
  const screenshot = join(directory, "screenshot.png");
  await Bun.write(screenshot, Buffer.from(PNG_BASE64, "base64"));

  const message = await sendChannelMessageFromAgent(channel.id, {
    content: "The layout is ready for review.",
    attachmentPaths: [screenshot],
  });

  expect(message).toMatchObject({
    sequence: 1,
    sender: { type: "agent", agentId: channel.id },
    content: "The layout is ready for review.",
    attachments: [screenshot],
  });
  expect((await channels.listMessagesAfter(channel.id)).at(-1)).toEqual(message);
});

test("joining starts onboarding before any mention; later assignments use normal delivery", async () => {
  currentDb = await createTestDatabase();
  const channels = new ChannelDatabase(currentDb);
  const channel = await createStoredChannel(channels, { name: "Onboarding", ...CHANNEL_DEFAULTS });
  const onboarding = Promise.withResolvers<{ status: "completed" }>();
  let admittedAtStart: unknown;
  const create = spyOn(sessionRuntime, "createSession").mockImplementation(async (id) => {
    admittedAtStart = {
      member: await channels.getMember(id),
      announcement: (await channels.listMessagesAfter(channel.id)).at(-1)?.content,
    };
    return { disposition: "started", waitForCompletion: () => onboarding.promise };
  });
  const deliver = spyOn(sessionRuntime, "deliverSessionMessage").mockResolvedValue({
    disposition: "queued",
    waitForCompletion: () => onboarding.promise,
  });
  const { waitForSessions } = sessionRuntime;
  let memberId: string | undefined;
  onTestFinished(async () => {
    onboarding.resolve({ status: "completed" });
    if (memberId) await waitForSessions([memberId]);
    create.mockRestore();
    deliver.mockRestore();
    releaseChannelEvents(channel.id);
    await currentDb?.close();
    currentDb = undefined;
  });
  const member = await createChannelMember({ channelId: channel.id, name: "Reviewer" });
  memberId = member.id;
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]?.[1]).toMatchObject({
    content: expect.stringContaining("complete any missing profile details"),
  });
  expect(deliver).not.toHaveBeenCalled();
  expect((await channels.getMember(member.id))?.status).toBeUndefined();
  await postChannelMessageFromSession("user", {
    id: crypto.randomUUID(),
    channelId: channel.id,
    content: "@reviewer inspect the result.",
  });
  expect(deliver.mock.calls[0]?.[0]).toBe(member.id);
  onboarding.resolve({ status: "completed" });
  await expect(waitForSessions([member.id])).resolves.toEqual([{ status: "completed" }]);
  expect(admittedAtStart).toMatchObject({
    member: { id: member.id, name: "Reviewer" },
    announcement: { type: "member_joined", member: { id: member.id } },
  });
  expect(await channels.getMember(member.id)).not.toBeNull();
  await postChannelMessageFromSession("user", {
    id: crypto.randomUUID(),
    channelId: channel.id,
    content: "@reviewer check the next result.",
  });
  expect(create).toHaveBeenCalledTimes(1);
  expect(deliver).toHaveBeenCalledTimes(2);
});

test("only the Channel lead can create members", async () => {
  const channels = await openChannels();

  const channel = await createStoredChannel(channels, {
    name: "Product studio",
    ...CHANNEL_DEFAULTS,
  });

  const peers = await createChannelMembersFromLead(channel.id, [
    {
      name: "Designer",
      role: "Turns product direction into clear interaction design.",
      model: { provider: "copilot", name: "designer-model" },
    },
    {
      name: "Engineer",
      role: "Builds the agreed product direction.",
    },
  ]);

  expect(peers).toMatchObject([
    {
      channelId: channel.id,
      name: "Designer",
      role: "Turns product direction into clear interaction design.",
      model: { provider: "copilot", name: "designer-model" },
    },
    {
      channelId: channel.id,
      name: "Engineer",
      role: "Builds the agreed product direction.",
    },
  ]);
  expect((await channels.listMembers(channel.id)).map(({ name }) => name)).toEqual([
    "Designer",
    "Engineer",
  ]);
  await expect(
    createChannelMembersFromLead(peers[0]!.id, [{ name: "Researcher" }]),
  ).rejects.toThrow("Only the channel lead can create members.");
});

test("channel tools use agentId across creation, context, profile updates, and waiting", async () => {
  await openChannels();

  const { channel } = await invokeTool("create_channel", { name: "Identity", ...CHANNEL_DEFAULTS });
  const channelId = channel.channelId;
  onTestFinished(() => releaseChannelEvents(channelId));
  expect(channel.lead).toEqual({ agentId: channelId, mention: "@lead" });
  expect((await invokeTool("list_channels")).channels[0].lead).toEqual(channel.lead);

  const { members } = await invokeTool("create_channel_members", {
    channelId,
    members: [{ name: "Reviewer" }],
  });
  const member = members[0];
  expect(member).toEqual({ agentId: expect.any(String), mention: "@reviewer" });
  const profile = await invokeTool(
    "update_member",
    { role: "Review the outcome." },
    member.agentId,
  );
  expect(profile.agentId).toBe(member.agentId);
  expect(profile).not.toHaveProperty("id");

  // Stored work left behind by an idle session must not appear as active work to peers.
  await setChannelAgentStatus(member.agentId, { status: "Reviewing" });
  const context = await invokeTool("read_channel", { channelId });
  expect(context.lead.agentId).toBe(channel.lead.agentId);
  expect(context.members).toEqual([
    {
      agentId: member.agentId,
      name: "Reviewer",
      mention: "@reviewer",
      role: "Review the outcome.",
    },
  ]);
  expect(context.messages[0].content).toEqual({ type: "member_joined", agentId: member.agentId });
  expect(
    await invokeTool("wait_for_channel_agents", {
      channelId,
      agentIds: [context.lead.agentId, context.members[0].agentId],
    }),
  ).toEqual({
    agents: [
      { agentId: channelId, status: "completed" },
      { agentId: member.agentId, status: "completed" },
    ],
  });
});

test("a Session can seed and passively read Channel context", async () => {
  const getDirectory = spyOn(sessions, "getSessionDirectory").mockResolvedValue(undefined);
  onTestFinished(() => getDirectory.mockRestore());
  const channels = await openChannels();
  const directory = await mkdtemp(join(tmpdir(), "toy-box-channel-session-"));
  onTestFinished(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const channel = await createStoredChannel(channels, {
    name: "Research",
    directory,
    ...CHANNEL_DEFAULTS,
  });
  await Promise.all([
    Bun.write(join(directory, "evidence.png"), Buffer.from(PNG_BASE64, "base64")),
    Bun.write(join(directory, "brief.md"), "# Brief"),
  ]);
  const deliver = spyOn(sessionRuntime, "deliverSessionMessage").mockResolvedValue({
    disposition: "started",
    waitForCompletion: async () => ({ status: "completed" }),
  });
  onTestFinished(() => deliver.mockRestore());

  const message = await postChannelMessageFromSession("coordinator-session", {
    id: "kickoff",
    channelId: channel.id,
    content: "Review the evidence and brief.",
    attachmentPaths: [join(directory, "evidence.png")],
  });
  const artifact = await invokeTool(
    "share_channel_artifact",
    { channelId: channel.id, path: "brief.md", title: "Research brief" },
    "coordinator-session",
  );
  await updateChannelFromLead(channel.id, {
    purpose: "Turn the evidence into a useful recommendation.",
    tasks: [{ id: "synthesize", title: "Synthesize the evidence", status: "in_progress" }],
    previewUrl: "http://127.0.0.1:3000",
  });
  const outcome = { artifactId: artifact.artifactId, diff: { added: 32, removed: 8 } };
  expect(
    await invokeTool(
      "edit_channel_tasks",
      { operations: [{ type: "update", taskId: "synthesize", patch: outcome }] },
      channel.id,
    ),
  ).toEqual({ taskIds: ["synthesize"] });

  const result = await invokeTool("read_channel", { channelId: channel.id });
  expect(result).toMatchObject({
    channel: {
      purpose: "Turn the evidence into a useful recommendation.",
      tasks: [
        { id: "synthesize", title: "Synthesize the evidence", status: "in_progress", ...outcome },
      ],
      previewUrl: "http://127.0.0.1:3000",
    },
    members: [],
    messages: expect.arrayContaining([
      expect.objectContaining({
        sequence: message.sequence,
        sender: { type: "user" },
        attachments: [join(directory, "evidence.png")],
      }),
      expect.objectContaining({
        content: { type: "artifact_shared", actor: { type: "user" }, artifact },
      }),
    ]),
    artifacts: [
      {
        artifactId: workspaceFileId(machineFile(join(directory, "brief.md"))),
        path: join(directory, "brief.md"),
        title: "Research brief",
      },
    ],
    hasMore: false,
  });
  expect(result.artifacts).toEqual([artifact]);
  expect((await channels.getChannel(channel.id))?.seenThrough).toBe(0);
  expect(deliver).toHaveBeenCalledWith(channel.id, {
    systemMessage: { type: "channel_message", senderName: "the user" },
    immediate: true,
  });
  expect(await readChannelForSession(channel.id, message.sequence + 1)).toMatchObject({
    messages: [{ id: "kickoff" }],
    hasMore: false,
  });
});

test("committed edits and reads replay to the durable view and only a new purpose wakes the lead", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Planning", ...CHANNEL_DEFAULTS });
  const initial = (await getChannelSnapshot(channel.id))!;
  const channelEvents: ChannelEvent[] = [];
  const workspaceUpdates: string[] = [];
  onTestFinished(subscribeChannelEvents(channel.id, (event) => channelEvents.push(event)));
  onTestFinished(() => releaseChannelEvents(channel.id));
  onTestFinished(
    workspaceEvents.subscribeWorkspaceEvents((event) => {
      if (event.type === "channel.upserted" && event.channel.id === channel.id) {
        workspaceUpdates.push(event.channel.name);
      }
    }),
  );

  const deliver = spyOn(sessionRuntime, "deliverSessionMessage").mockResolvedValue({
    disposition: "started",
    waitForCompletion: async () => ({ status: "completed" }),
  });
  onTestFinished(() => deliver.mockRestore());

  await editChannel({
    channelId: channel.id,
    name: "Shipping",
    purpose: "Ship the result.",
  });
  expect(channelEvents.map(({ type, revision }) => [type, revision])).toEqual([
    ["message", 1],
    ["message", 2],
  ]);
  expect(workspaceUpdates).toEqual(["Shipping"]);
  expect(channelEvents[0]).toMatchObject({ message: { content: { actor: { type: "user" } } } });
  expect(deliver).toHaveBeenCalledWith(channel.id, {
    systemMessage: { type: "channel_message", senderName: "the user" },
    immediate: true,
  });
  expect(deliver).toHaveBeenCalledTimes(1);

  await editChannel({ channelId: channel.id, name: "Shipping", purpose: "Ship the result." });
  expect(channelEvents).toHaveLength(2);
  expect(workspaceUpdates).toEqual(["Shipping"]);
  await editChannel({ channelId: channel.id, name: "Shipped" });
  expect(channelEvents).toHaveLength(3);
  expect(workspaceUpdates).toEqual(["Shipping", "Shipped"]);

  const beforeTasks = (await channels.getChannel(channel.id))!;
  const tasks = [
    { id: "verify", title: "Verify", status: "pending", diff: { added: 3, removed: 1 } },
  ] as const;
  await editChannelTasksFromLead(channel.id, {
    operations: [{ type: "add", task: tasks[0] }],
  });
  expect(await channels.getChannel(channel.id)).toMatchObject({
    latestSequence: beforeTasks.latestSequence,
    updatedAt: beforeTasks.updatedAt,
  });
  await updateChannelFromLead(channel.id, { previewUrl: "http://localhost:3000" });
  const model = { provider: "copilot", name: "gpt-6" };
  await editChannel({ channelId: channel.id, model });
  await markChannelRead(channel.id, 100);
  await markChannelRead(channel.id, 1);
  await updateChannelFromLead(channel.id, {
    tasks: [...tasks],
    previewUrl: "http://localhost:3000",
  });
  await editChannel({ channelId: channel.id, model });
  expect(channelEvents.slice(3).map(({ type, revision }) => [type, revision])).toEqual([
    ["tasks", 4],
    ["message", 5],
    ["model", 6],
    ["read", 7],
  ]);
  expect(channelEvents.at(-1)).toEqual({
    type: "read",
    revision: 7,
    seenThrough: 4,
  });
  const projected = channelEvents.reduce(reduceChannelState, initial);
  expect(projected).toEqual((await getChannelSnapshot(channel.id))!);
  expect(deliver).toHaveBeenCalledTimes(1);
});

test("a lead directory assignment only saves metadata and publishes real changes", async () => {
  const channels = await openChannels();
  const root = await mkdtemp(join(tmpdir(), "toy-box-channel-directory-"));
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const channel = await createStoredChannel(channels, { name: "Planning", ...CHANNEL_DEFAULTS });
  const events: ChannelEvent[] = [];
  const updates: string[] = [];
  onTestFinished(subscribeChannelEvents(channel.id, (event) => events.push(event)));
  onTestFinished(() => releaseChannelEvents(channel.id));
  onTestFinished(
    workspaceEvents.subscribeWorkspaceEvents((event) => {
      if (event.type === "channel.upserted" && event.channel.id === channel.id) {
        updates.push(event.channel.directory ?? "");
      }
    }),
  );
  const nextDirectory = join(root, "nested", "workspace");
  expect(await updateChannelFromLead(channel.id, { directory: nextDirectory })).toMatchObject({
    directory: nextDirectory,
  });
  await expect(stat(nextDirectory)).rejects.toThrow();
  await updateChannelFromLead(channel.id, { directory: nextDirectory });
  expect(await updateChannelFromLead(channel.id, { directory: null })).toMatchObject({
    directory: undefined,
  });
  expect(events.map((event) => event.type)).toEqual(["message", "message"]);
  expect(updates).toEqual([nextDirectory, ""]);
});

test("editing member metadata publishes a roster change only when something changed", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Review", ...CHANNEL_DEFAULTS });
  const { member } = await channels.createMember(
    channelAgent(channel.id, "reviewer-session", "Reviewer"),
  );
  const events: ChannelEvent[] = [];
  let rosterChanges = 0;
  onTestFinished(subscribeChannelEvents(channel.id, (event) => events.push(event)));
  onTestFinished(() => releaseChannelEvents(channel.id));
  onTestFinished(
    workspaceEvents.subscribeWorkspaceEvents((event) => {
      if (event.type === "channel.member.upserted" || event.type === "channel.member.deleted")
        rosterChanges++;
    }),
  );

  const input = {
    agentId: member.id,
    name: "Revised Reviewer",
    role: "Review the implementation.",
    model: { provider: "copilot", name: "gpt-6" },
  };
  const updated = await updateChannelMember(input);
  await updateChannelMember(input);
  expect(events).toMatchObject([{ type: "member", member: updated }]);
  expect(events).toHaveLength(1);
  expect(rosterChanges).toBe(1);
});

test("a Channel Agent publishes focus and settles temporary turn state", async () => {
  const channels = await openChannels();

  const channel = await createStoredChannel(channels, {
    name: "Protocol review",
    ...CHANNEL_DEFAULTS,
  });
  const { member } = await channels.createMember(
    channelAgent(channel.id, "reviewer-session", "Reviewer"),
  );
  const first = await channels.appendMessage({
    id: "message-1",
    channelId: channel.id,
    sender: { type: "user" },
    content: "Review the protocol.",
  });
  await setChannelAgentStatus(member.id, {
    status: "Reviewing the protocol",
    lookingAt: first.message.sequence,
  });
  expect(await channels.getMember(member.id)).toMatchObject({
    status: {
      state: "working",
      text: "Reviewing the protocol",
      lookingAt: first.message.sequence,
    },
  });
  await setChannelAgentStatus(member.id, {
    status: "Implementing the revision",
    workingOn: first.message.sequence,
  });
  await setChannelMessageReactionFromAgent(member.id, {
    sequence: first.message.sequence,
    reaction: "love",
  });
  await finishChannelAgentTurn(member.id, "implementation feedback");

  expect(await channels.getMember(member.id)).toMatchObject({
    status: { state: "waiting", text: "implementation feedback" },
  });
  const messages = await channels.listMessagesAfter(channel.id);
  expect(messages.find(({ id }) => id === first.message.id)?.reactions).toEqual([
    { agentId: member.id, reaction: "love" },
  ]);
  await setChannelAgentStatus(member.id, { status: "Checking the revision" });
  await finishChannelAgentTurn(member.id);
  expect((await channels.getMember(member.id))?.status).toBeUndefined();
});

test("session completion and startup clear working status, preserving waits and subsequent turns", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Activity", ...CHANNEL_DEFAULTS });
  const { member } = await channels.createMember(channelAgent(channel.id, "active", "Active"));
  const { member: waiting } = await channels.createMember(
    channelAgent(channel.id, "waiting", "Waiting"),
  );
  await setChannelAgentStatus(channel.id, { status: "Left over from shutdown" });
  await setChannelAgentStatus(member.id, { status: "Still running" });
  await finishChannelAgentTurn(waiting.id, "CI", 20);
  const wait = (await channels.getAgent(waiting.id))!.status;
  setSessionStatus(member.id, "running");
  onTestFinished(() => {
    deleteSessionState(member.id);
    deleteSessionState(waiting.id);
    deleteSessionState(channel.id);
  });
  const events: ChannelEvent[] = [];
  onTestFinished(subscribeChannelEvents(channel.id, (event) => events.push(event)));
  onTestFinished(await startChannels());
  expect((await channels.getAgent(channel.id))?.status).toBeUndefined();
  expect((await channels.getAgent(member.id))?.status?.state).toBe("working");
  expect((await channels.getAgent(waiting.id))?.status).toEqual(wait);

  for (const status of ["idle", "unread"] as const) {
    await setChannelAgentStatus(member.id, { status: "Finishing" });
    const cleared = Promise.withResolvers<void>();
    const unsubscribe = subscribeChannelEvents(channel.id, (event) => {
      if (event.type === "status" && event.agentId === member.id && !event.status)
        cleared.resolve();
    });
    setSessionStatus(member.id, status);
    await cleared.promise;
    unsubscribe();
    expect((await channels.getAgent(member.id))?.status).toBeUndefined();
  }
  setSessionStatus(waiting.id, "idle");
  await setChannelAgentStatus(member.id, { status: "Old turn" });
  setSessionStatus(member.id, "idle");
  setSessionStatus(member.id, "running");
  await setChannelAgentStatus(member.id, { status: "New turn" });
  expect((await channels.getAgent(member.id))?.status).toEqual({
    state: "working",
    text: "New turn",
  });
  expect((await channels.getAgent(waiting.id))?.status).toEqual(wait);
  expect(events.every(({ type }) => type === "status")).toBe(true);
});

function spyOnDelivery() {
  const deliver = spyOn(sessionRuntime, "deliverSessionMessage").mockResolvedValue({
    disposition: "started",
    waitForCompletion: async () => ({ status: "completed" }),
  });
  const broadcasts = spyOn(workspaceEvents, "broadcast").mockImplementation(() => {});
  onTestFinished(() => {
    deliver.mockRestore();
    broadcasts.mockRestore();
  });
  return deliver;
}

test("a lead follow-up privately wakes it once when due", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Deploy", ...CHANNEL_DEFAULTS });
  const deliver = spyOnDelivery();
  setSystemTime(new Date("2026-09-29T15:00:00.000Z"));
  onTestFinished(() => setSystemTime());

  await finishChannelAgentTurn(channel.id, "CI to finish", 20);
  expect((await channels.getAgent(channel.id))?.status).toEqual({
    state: "waiting",
    text: "CI to finish",
    wakeAt: "2026-09-29T15:20:00.000Z",
  });
  await wakeDueChannelAgents(new Date("2026-09-29T15:19:00.000Z"));
  expect(deliver).not.toHaveBeenCalled();
  await wakeDueChannelAgents(new Date("2026-09-29T15:20:00.000Z"));
  await wakeDueChannelAgents(new Date("2026-09-29T15:21:00.000Z"));

  expect(deliver.mock.calls).toEqual([
    [
      channel.id,
      {
        systemMessage: { type: "channel_follow_up", waitingFor: "CI to finish" },
        immediate: true,
      },
    ],
  ]);
  expect((await channels.getAgent(channel.id))?.status).toBeUndefined();
});

test("a message that wakes the lead first cancels its follow-up", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Deploy", ...CHANNEL_DEFAULTS });
  const deliver = spyOnDelivery();

  await finishChannelAgentTurn(channel.id, "CI to finish", 20);
  await postChannelMessageFromSession("user-session", {
    id: "update",
    channelId: channel.id,
    content: "CI passed.",
  });
  await wakeDueChannelAgents(new Date(Date.now() + 30 * 60_000));

  expect(deliver.mock.calls).toEqual([
    [
      channel.id,
      { systemMessage: { type: "channel_message", senderName: "the user" }, immediate: true },
    ],
  ]);
});

test("a due routine privately wakes its lead without adding to the transcript", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Watch", ...CHANNEL_DEFAULTS });
  const events: ChannelEvent[] = [];
  const unsubscribe = subscribeChannelEvents(channel.id, (event) => events.push(event));
  onTestFinished(() => {
    unsubscribe();
    releaseChannelEvents(channel.id);
  });
  const deliver = spyOnDelivery();

  const routine = await setChannelRoutineFromLead(channel.id, {
    title: "CI",
    schedule: "0 * * * *",
    prompt: "Check CI",
  });
  const { latestSequence } = (await channels.getChannel(channel.id))!;
  await wakeDueChannelAgents(new Date(Date.now() + 61 * 60_000));

  expect(
    events.filter((event) => event.type === "message").map((event) => event.message.content),
  ).toEqual([{ type: "routine_scheduled", routine }]);
  expect(deliver.mock.calls).toEqual([
    [
      channel.id,
      {
        systemMessage: { type: "channel_routine", title: "CI", prompt: "Check CI" },
        immediate: true,
      },
    ],
  ]);
  expect((await channels.getChannel(channel.id))?.latestSequence).toBe(latestSequence);
});

test("running a routine wakes its lead now and leaves its schedule alone", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Watch", ...CHANNEL_DEFAULTS });
  const deliver = spyOnDelivery();
  const routine = await setChannelRoutineFromLead(channel.id, {
    title: "CI",
    schedule: "0 * * * *",
    prompt: "Check CI",
  });
  const wake: Parameters<typeof sessionRuntime.deliverSessionMessage> = [
    channel.id,
    {
      systemMessage: { type: "channel_routine", title: "CI", prompt: "Check CI" },
      immediate: true,
    },
  ];

  expect(await runChannelRoutine(channel.id, routine.id)).toBe(true);
  await wakeDueChannelAgents(new Date(Date.now() + 61 * 60_000));

  expect(deliver.mock.calls).toEqual([wake, wake]);
});
