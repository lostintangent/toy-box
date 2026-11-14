import { channelAgent, channelCatalog, createStoredChannel } from "@channels/server/testFixtures";
import {
  afterAll,
  beforeEach,
  expect,
  mock,
  onTestFinished,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ChannelEvent } from "@channels/model";
import { machineFile, workspaceFileId } from "@files/model";
import { createFileServeUrl } from "@files/model/paths";
import { reduceChannelState } from "@channels/model/reducer";
import { openTestDatabase } from "@/server/testFixtures";
import { getServer } from "@workspace/server/installation";
import { servePeer, setPeers, toyBoxServer } from "@workspace/server/testFixtures";
import { toolResultText, type Tool } from "@sessions/server/tools/definition";

// Mock first, then import everything the test exercises or inspects, so the test and the
// code under test share one module graph and no Session reaches a real provider.
const realRuntime = { ...(await import("@sessions/server/runtime")) };
const runtime = {
  createSession: mock<typeof realRuntime.createSession>(),
  deliverSessionMessage: mock<typeof realRuntime.deliverSessionMessage>(),
  deleteSessionIfExists: mock<typeof realRuntime.deleteSessionIfExists>(),
  getSessionDirectory: mock<typeof realRuntime.getSessionDirectory>(),
};
mock.module("@sessions/server/runtime", () => ({ ...realRuntime, ...runtime }));
afterAll(() => {
  mock.module("@sessions/server/runtime", () => realRuntime);
});

const { detachManagedSession } = await import("@/server/managedSessions");
const { RefusalError } = await import("@/shared/server/http");
const { getPersistedWorker } = await import("@workers/server/database");
const { setSessionProvider } = await import("@sessions/server/state/sessions");
const { deleteSessionActivity, setSessionActivity } =
  await import("@sessions/server/state/activity");
const workspaceEvents = await import("@workspace/server/events");
const { ChannelDatabase } = await import("./database");
const {
  createChannel,
  deleteChannel,
  createChannelMember,
  createChannelMembers,
  editChannel,
  editChannelTasks,
  finishChannelAgentTurn,
  getChannelMemberProvider,
  markChannelRead,
  messageChannelLead,
  postChannelMessage,
  readChannel,
  runChannelRoutine,
  setChannelAgentStatus,
  setChannelMessageReaction,
  setChannelRoutine,
  updateChannel,
  updateChannelMember,
  wakeDueChannelAgents,
} = await import("./index");
const { deleteChannelFiles } = await import("./attachments");
const { subscribeChannelEvents, releaseChannelEvents } = await import("./eventLog");
const { getChannelSnapshot } = await import("./stream");
const { default: startChannels } = await import("./startup");
const { channelLeadTools, channelMemberTools, channelTools, createChannelMembersTool } =
  await import("./tools");

beforeEach(() => {
  const started: Awaited<ReturnType<typeof realRuntime.deliverSessionMessage>> = {
    disposition: "started",
    waitForCompletion: async () => ({ status: "completed" }),
  };
  runtime.createSession.mockReset().mockResolvedValue(started);
  runtime.deliverSessionMessage.mockReset().mockResolvedValue(started);
  runtime.deleteSessionIfExists.mockReset().mockResolvedValue(true);
  runtime.getSessionDirectory.mockReset().mockResolvedValue(undefined);
});

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const CHANNEL_DEFAULTS = {
  purpose: "Coordinate the work to a useful result.",
  model: { provider: "copilot", name: "gpt-5.5" },
} as const;

/** Attachments land in the real home, which Bun resolves once per process. */
function channelFolder(channelId: string) {
  onTestFinished(() => deleteChannelFiles(channelId));
  return join(homedir(), ".toy-box", "channels", channelId);
}

async function openChannels() {
  setPeers();
  return new ChannelDatabase(await openTestDatabase());
}

async function invokeTool(name: string, input = {}, sessionId = "coordinator", agentOnly = false) {
  const tool = [
    ...(agentOnly ? [] : channelTools),
    createChannelMembersTool,
    ...channelMemberTools,
    ...channelLeadTools,
  ].find((tool) => tool.name === name) as Tool | undefined;
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return JSON.parse(
    toolResultText(await tool.handler(tool.parameters?.parse(input) ?? input, sessionId)),
  );
}

test("attention uses normal messages and upserts, and a user reply also wakes the lead", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Attention", ...CHANNEL_DEFAULTS });
  const { member } = await channels.createMember(channelAgent(channel.id, "builder", "Builder"));
  const events: ChannelEvent[] = [];
  const unsubscribe = subscribeChannelEvents(channel.id, (event) => events.push(event));
  const broadcasts = spyOn(workspaceEvents, "broadcast").mockImplementation(() => {});
  const deliver = runtime.deliverSessionMessage;
  onTestFinished(async () => {
    unsubscribe();
    releaseChannelEvents(channel.id);
    broadcasts.mockRestore();
  });

  await setChannelAgentStatus(channel.id, { status: "Finishing" });
  const request = await postChannelMessage(
    { id: "request", channelId: channel.id, content: "Choose the next task.", request: true },
    { type: "agent", agentId: channel.id },
  );
  await updateChannel(channel.id, {
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
  await postChannelMessage(
    { id: "decision", channelId: channel.id, content: "@builder use blue." },
    { type: "user" },
  );
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
  const leadStarted = Promise.withResolvers<Parameters<typeof realRuntime.createSession>>();
  let leadWorker: Awaited<ReturnType<typeof getPersistedWorker>> = null;
  runtime.createSession.mockImplementation(async (...args) => {
    leadWorker = await getPersistedWorker(args[0]);
    leadStarted.resolve(args);
    return {
      disposition: "started",
      waitForCompletion: async () => ({ status: "completed" }),
    };
  });

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
  expect(leadWorker).toMatchObject({ type: "channel" });
  expect(message).toMatchObject({
    content: "This channel was just created. Begin working toward its purpose.",
  });
  expect(options).toMatchObject({ name: "Lead · Bitmap studio" });
});

test.each([false, true])(
  "channel deletion publishes once and attempts all session cleanup (failure=%s)",
  async (failCleanup) => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, { name: "Delete", ...CHANNEL_DEFAULTS });
    await channels.createMember(channelAgent(channel.id, "builder", "Builder"));
    await channels.createMember(channelAgent(channel.id, "reviewer", "Reviewer"));
    const agentIds = (await channels.listAgents(channel.id)).map(({ id }) => id);
    const folder = channelFolder(channel.id);
    await Bun.write(join(folder, "attachments", "upload", "image.png"), "");
    const observed: unknown[] = [];
    onTestFinished(subscribeChannelEvents(channel.id, (event) => observed.push(event)));
    const broadcasts = spyOn(workspaceEvents, "broadcast").mockImplementation((event) => {
      observed.push(event);
    });
    runtime.deleteSessionIfExists.mockImplementation(async (id) => {
      observed.push(id);
      await detachManagedSession(id);
      if (failCleanup && id === "builder") throw new Error("Provider cleanup failed");
      return true;
    });
    onTestFinished(() => broadcasts.mockRestore());

    const deletion = deleteChannel(channel.id);
    if (failCleanup)
      await expect(deletion).rejects.toThrow("Channel deleted; agent cleanup failed.");
    else expect(await deletion).toBe(true);
    expect(await deleteChannel(channel.id)).toBe(false);
    expect(await channels.getChannel(channel.id)).toBeNull();
    expect(await channels.listAgents(channel.id)).toEqual([]);
    expect(observed[0]).toEqual({ type: "channel.deleted", channelId: channel.id });
    expect(observed.slice(1)).toEqual(expect.arrayContaining(agentIds));
    expect(observed).toHaveLength(agentIds.length + 1);
    await expect(stat(folder)).rejects.toThrow();
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
  const deliver = runtime.deliverSessionMessage.mockImplementation(async () => {
    announceWake();
    await wakeFinished;
    return {
      disposition: "queued",
      waitForCompletion: async () => ({ status: "completed" }),
    };
  });

  let settled = false;
  const input = {
    id: "review-request",
    channelId: channel.id,
    content: "@reviewer please inspect this.",
  };
  const post = postChannelMessage(input, { type: "user" }).then(() => {
    settled = true;
  });
  await wakeStarted;
  expect(settled).toBe(false);
  releaseWake();
  await post;
  expect((await channels.getMember(member.id))?.status).toBeUndefined();
  await postChannelMessage(input, { type: "user" });
  expect(deliver).toHaveBeenCalledTimes(1);
  expect((await channels.getChannel(channel.id))?.latestSequence).toBe(2);
});

test("concurrent posts of one message ID store it once and return it to every retry", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Retries", ...CHANNEL_DEFAULTS });
  onTestFinished(() => releaseChannelEvents(channel.id));
  const [first, second] = await Promise.all(
    ["First", "Second"].map((content) =>
      postChannelMessage({ id: "retried", channelId: channel.id, content }, { type: "user" }),
    ),
  );
  expect(second).toEqual(first);
  expect((await channels.getChannel(channel.id))?.latestSequence).toBe(1);
});

test("an Agent's image and video files are copied into its Channel and outlive their source", async () => {
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
  const recording = join(directory, "flow.webm");
  await Bun.write(screenshot, Buffer.from(PNG_BASE64, "base64"));
  await Bun.write(recording, "webm");

  const message = await postChannelMessage(
    {
      id: "review",
      channelId: channel.id,
      content: "The layout is ready for review.",
      attachments: [screenshot, recording],
    },
    { type: "agent", agentId: channel.id },
  );
  await rm(directory, { recursive: true, force: true });

  const stored = join(channelFolder(channel.id), "attachments", message.id);
  expect(message).toMatchObject({
    sequence: 1,
    sender: { type: "agent", agentId: channel.id },
    content: "The layout is ready for review.",
    attachments: [
      { name: "screenshot.png", mimeType: "image/png" },
      { name: "flow.webm", mimeType: "video/webm" },
    ],
  });
  expect((await channels.listMessagesAfter(channel.id)).at(-1)).toEqual(message);
  expect(await Bun.file(join(stored, "flow.webm")).text()).toBe("webm");
});

test("a user's uploads become Channel files that clients resolve", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Uploads", ...CHANNEL_DEFAULTS });
  const upload = { mimeType: "image/png", base64: PNG_BASE64 };
  const post = (id: string, channelId = channel.id) =>
    postChannelMessage(
      { id, channelId, content: "", attachments: [upload, upload] },
      { type: "user" },
    );
  await expect(post("../escape")).rejects.toThrow(RefusalError);
  await expect(post("lost", "missing")).rejects.toThrow("Channel not found.");
  await expect(stat(channelFolder("missing"))).rejects.toThrow();

  const message = await post("uploads");
  const stored = join(channelFolder(channel.id), "attachments", "uploads");
  const paths = [join(stored, "image.png"), join(stored, "image-2.png")];
  expect(message.attachments).toEqual(
    paths.map((path) => ({
      name: basename(path),
      url: createFileServeUrl(machineFile(path)),
      mimeType: "image/png",
    })),
  );
});

test("joining starts onboarding before any mention; later assignments use normal delivery", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Onboarding", ...CHANNEL_DEFAULTS });
  const onboarding = Promise.withResolvers<{ status: "completed" }>();
  let admittedAtStart: unknown;
  const create = runtime.createSession.mockImplementation(async (id) => {
    admittedAtStart = {
      member: await channels.getMember(id),
      announcement: (await channels.listMessagesAfter(channel.id)).at(-1)?.content,
    };
    return { disposition: "started", waitForCompletion: () => onboarding.promise };
  });
  const deliver = runtime.deliverSessionMessage.mockResolvedValue({
    disposition: "queued",
    waitForCompletion: () => onboarding.promise,
  });
  const { waitForSessions } = realRuntime;
  let memberId: string | undefined;
  onTestFinished(async () => {
    onboarding.resolve({ status: "completed" });
    if (memberId) await waitForSessions([memberId]);
    releaseChannelEvents(channel.id);
  });
  const member = await createChannelMember({ channelId: channel.id, name: "Reviewer" });
  memberId = member.id;
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]?.[1]).toMatchObject({
    content: expect.stringContaining("complete any missing profile details"),
  });
  expect(deliver).not.toHaveBeenCalled();
  expect((await channels.getMember(member.id))?.status).toBeUndefined();
  await postChannelMessage(
    { id: crypto.randomUUID(), channelId: channel.id, content: "@reviewer inspect the result." },
    { type: "user" },
  );
  expect(deliver.mock.calls[0]?.[0]).toBe(member.id);
  onboarding.resolve({ status: "completed" });
  await expect(waitForSessions([member.id])).resolves.toEqual([{ status: "completed" }]);
  expect(admittedAtStart).toMatchObject({
    member: { id: member.id, name: "Reviewer" },
    announcement: { type: "member_joined", member: { id: member.id } },
  });
  expect(await channels.getMember(member.id)).not.toBeNull();
  await postChannelMessage(
    { id: crypto.randomUUID(), channelId: channel.id, content: "@reviewer check the next result." },
    { type: "user" },
  );
  expect(create).toHaveBeenCalledTimes(1);
  expect(deliver).toHaveBeenCalledTimes(2);
});

test("a Channel lead edits and removes only its own members, by ID or mention", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Studio", ...CHANNEL_DEFAULTS });
  const other = await createStoredChannel(channels, { name: "Elsewhere", ...CHANNEL_DEFAULTS });
  const { member: outsider } = await channels.createMember(
    channelAgent(other.id, "scout", "Scout"),
  );

  const [designer] = await createChannelMembers(channel.id, [{ name: "Designer" }]);
  const model = { provider: "claude", name: "opus" };
  await invokeTool("update_channel_member", { agentId: "@designer", model }, channel.id);
  expect(await invokeTool("read_channel", { detail: "full" }, channel.id, true)).toMatchObject({
    members: [{ agentId: designer!.id, model }],
  });
  for (const agentId of [outsider.id, "@scout", channel.id, "@lead"]) {
    await expect(
      invokeTool("update_channel_member", { agentId, model }, channel.id),
    ).rejects.toThrow("Member not found in this channel.");
    await expect(invokeTool("remove_channel_member", { agentId }, channel.id)).rejects.toThrow(
      "Member not found in this channel.",
    );
  }
  const removeMember = channelLeadTools.find(
    ({ name }) => name === "remove_channel_member",
  ) as Tool;
  expect(await removeMember.handler({ agentId: "@designer" }, channel.id)).toBe("Removed.");
  const { messages } = await invokeTool("read_channel", {}, channel.id, true);
  expect(messages.at(-1).content).toMatchObject({
    type: "member_left",
    actor: { type: "agent", agentId: channel.id },
    agentId: designer!.id,
  });
});

test("leads also list the channels on peer servers", async () => {
  const channels = await openChannels();
  const lead = await createStoredChannel(channels, { name: "Core", ...CHANNEL_DEFAULTS });
  onTestFinished(() => releaseChannelEvents(lead.id));
  const studio = servePeer(
    toyBoxServer("Studio", channelCatalog([{ id: "apple", name: "Apple" }])),
  );
  setPeers(studio.href);
  const own = await invokeTool("list_channels", {}, lead.id);
  expect(await invokeTool("list_channels", {}, lead.id, true)).toEqual({
    channels: [...own.channels, { channelId: "apple", name: "Apple", server: "Studio" }],
  });
});

test("channel tools identify every agent by agentId", async () => {
  await openChannels();

  const { channel } = await invokeTool("create_channel", { name: "Identity", ...CHANNEL_DEFAULTS });
  const channelId = channel.channelId;
  onTestFinished(() => releaseChannelEvents(channelId));
  expect((await invokeTool("list_channels", {}, channelId, true)).channels).toEqual([channel]);

  const {
    members: [member],
  } = await invokeTool("create_channel_members", { channelId, members: [{ name: "Reviewer" }] });
  expect(member).toEqual({ agentId: expect.any(String), mention: "@reviewer" });
  const profile = await invokeTool(
    "update_member",
    { role: "Review the outcome." },
    member.agentId,
  );
  expect(profile.agentId).toBe(member.agentId);
  expect(profile).not.toHaveProperty("id");

  const context = await invokeTool("read_channel", { channelId });
  expect(context.lead.agentId).toBe(channelId);
  expect(context.members).toMatchObject([{ agentId: member.agentId }]);
  expect(context.messages[0].content).toEqual({ type: "member_joined", agentId: member.agentId });
  expect(
    await invokeTool("wait_for_channel_agents", {
      channelId,
      agentIds: ["@lead", member.agentId],
    }),
  ).toEqual({
    agents: [
      { agentId: channelId, status: "completed" },
      { agentId: member.agentId, status: "completed" },
    ],
  });
});

test("a Session can seed and passively read Channel context", async () => {
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
  const deliver = runtime.deliverSessionMessage;

  const message = await postChannelMessage(
    {
      id: "kickoff",
      channelId: channel.id,
      content: "Review the evidence and brief.",
      attachments: [join(directory, "evidence.png")],
    },
    { type: "user" },
  );
  const artifact = await invokeTool(
    "share_channel_artifact",
    { channelId: channel.id, path: "brief.md", title: "Research brief" },
    "coordinator-session",
  );
  await updateChannel(channel.id, {
    purpose: "Turn the evidence into a useful recommendation.",
    tasks: [{ id: "synthesize", title: "Synthesize the evidence", status: "in_progress" }],
    preview: { kind: "url", url: "http://127.0.0.1:3000" },
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
      preview: { kind: "url", url: "http://127.0.0.1:3000" },
    },
    members: [],
    messages: expect.arrayContaining([
      expect.objectContaining({
        sequence: message.sequence,
        sender: { type: "user" },
        attachments: [join(channelFolder(channel.id), "attachments", "kickoff", "evidence.png")],
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
  expect(await readChannel(channel.id, message.sequence + 1)).toMatchObject({
    messages: [{ id: "kickoff" }],
    hasMore: false,
  });
});

test("agents receive full context until their read cursor advances, whatever detail they request", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Orientation", ...CHANNEL_DEFAULTS });
  for (const input of [{}, { detail: "compact" }, { detail: "tasks" }]) {
    const result = await invokeTool("read_channel", input, channel.id, true);
    expect(result.channel.name).toBe(channel.name);
    expect(result.messages).toEqual([]);
  }
  await channels.appendMessage({
    channelId: channel.id,
    id: "first",
    sender: { type: "user" },
    content: "Start here.",
  });
  expect(await invokeTool("read_channel", { detail: "compact" }, channel.id, true)).toMatchObject({
    channel: { name: channel.name },
    messages: [{ content: "Start here." }],
  });
  expect(await invokeTool("read_channel", {}, channel.id, true)).toEqual({
    unfinishedTasks: [],
    agents: [],
    messages: [],
    hasMore: false,
  });
});

test("compact reads scope tasks and live statuses without losing idle authors or full context", async () => {
  setSystemTime(new Date("2026-10-23T15:00:00.000Z"));
  onTestFinished(() => setSystemTime());
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Catch up", ...CHANNEL_DEFAULTS });
  const { member: builder } = await channels.createMember(
    channelAgent(channel.id, "builder", "Builder"),
  );
  const { member: reviewer } = await channels.createMember(
    channelAgent(channel.id, "reviewer", "Reviewer"),
  );
  await channels.updateMember(builder.id, { role: "Build. ".repeat(1_000) });
  await channels.updateMember(reviewer.id, { role: "Review. ".repeat(1_000) });
  const mine = {
    id: "mine",
    title: "Build",
    status: "in_progress",
    ownerId: builder.id,
  } as const;
  const other = { id: "other", title: "Review", status: "blocked", ownerId: reviewer.id } as const;
  const unassigned = { id: "next", title: "Next", status: "pending" } as const;
  const tasks = [
    {
      id: "archive",
      title: "Shipped",
      status: "done" as const,
      children: Array.from({ length: 50 }, (_, index) => ({
        id: `done${index}`,
        title: "Completed outcome with its retained history. ".repeat(5).trim(),
        status: "done" as const,
      })),
    },
    {
      id: "milestone",
      title: "Ship",
      status: "in_progress" as const,
      ownerId: channel.id,
      children: [
        { ...mine, checkInAt: "2026-10-23T15:05:00.000Z" },
        other,
        unassigned,
        { id: "done", title: "Done", status: "done" as const },
      ],
    },
  ];
  await channels.updateChannel(channel.id, { tasks });
  setSystemTime(new Date("2026-10-23T15:12:00.000Z"));
  await channels.claimDueWakes(new Date());
  const canonicalTasks = (await channels.getChannel(channel.id))!.tasks;
  expect(await invokeTool("read_channel", { detail: "compact" }, builder.id, true)).toHaveProperty(
    "channel",
  );
  await invokeTool("read_channel", {}, channel.id, true);
  const { message } = await channels.appendMessage({
    channelId: channel.id,
    id: "handoff",
    sender: { type: "agent", agentId: reviewer.id },
    content: "The review is ready.",
  });
  const wait = {
    state: "waiting" as const,
    text: "Builder's result",
    wakeAt: "2027-01-01T00:00:00Z",
  };
  await channels.setAgentStatus(channel.id, wait);
  await channels.setAgentStatus(builder.id, {
    state: "working",
    text: "Building",
    workingOn: message.sequence,
  });
  await channels.setAgentStatus(reviewer.id, { state: "working", text: "Stale work" });
  setSessionActivity(builder.id, "running");
  onTestFinished(() => deleteSessionActivity(builder.id));

  const compact = await invokeTool("read_channel", {}, builder.id, true);
  expect(Object.keys(compact).sort()).toEqual(["agents", "hasMore", "messages", "unfinishedTasks"]);
  expect(compact.unfinishedTasks).toEqual([
    { ...tasks[1], elapsedMinutes: 12, children: [{ ...mine, elapsedMinutes: 12 }] },
  ]);
  expect(compact.agents).toEqual([
    { agentId: channel.id, name: "Lead", mention: "@lead", status: wait },
    {
      agentId: builder.id,
      name: builder.name,
      mention: "@builder",
      status: { state: "working", text: "Building", workingOn: message.sequence },
    },
  ]);
  expect(compact.messages).toMatchObject([
    {
      sequence: message.sequence,
      sender: { type: "agent", agentId: reviewer.id, name: reviewer.name, mention: "@reviewer" },
      content: message.content,
    },
  ]);
  expect((await invokeTool("read_channel", {}, channel.id, true)).unfinishedTasks).toEqual([
    {
      ...tasks[1],
      elapsedMinutes: 12,
      children: [{ ...mine, elapsedMinutes: 12 }, other, unassigned],
    },
  ]);
  const full = await invokeTool("read_channel", { detail: "full" }, builder.id, true);
  expect(full).toEqual(
    await invokeTool("read_channel", { channelId: channel.id, beforeSequence: 1 }),
  );
  expect(Buffer.byteLength(JSON.stringify(compact))).toBeLessThan(20_000);
  expect(full.channel.tasks).toEqual(canonicalTasks);
  expect(await invokeTool("read_channel", { detail: "tasks" }, builder.id, true)).toEqual({
    tasks: canonicalTasks,
    messages: [],
    hasMore: false,
  });
});

test("compact and full reads share paging and keep agent attachments as paths", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Paging", ...CHANNEL_DEFAULTS });
  const { member } = await channels.createMember(channelAgent(channel.id, "reader", "Reader"));
  await invokeTool("read_channel", {}, member.id, true);
  await channels.appendMessage({
    channelId: channel.id,
    id: "evidence",
    sender: { type: "agent", agentId: "removed" },
    content: "Evidence from a former member.",
    attachments: ["evidence.png", "evidence.mp4"],
  });
  for (let index = 0; index < 100; index++) {
    await channels.appendMessage({
      channelId: channel.id,
      id: `message${index}`,
      sender: { type: "user" },
      content: `Message ${index}`,
    });
  }
  const compact = await invokeTool("read_channel", {}, member.id, true);
  const evidence = join(channelFolder(channel.id), "attachments", "evidence");
  expect(compact.messages).toHaveLength(100);
  expect(compact.hasMore).toBe(true);
  expect(compact.messages[0]).toMatchObject({
    sender: { type: "agent", agentId: "removed", name: "Deleted agent" },
    content: "Evidence from a former member.",
    attachments: [join(evidence, "evidence.png"), join(evidence, "evidence.mp4")],
  });
  expect(compact.messages[0].sender).not.toHaveProperty("mention");
  expect(await invokeTool("read_channel", { detail: "full" }, member.id, true)).toMatchObject({
    channel: { name: channel.name },
    messages: [{ content: "Message 99" }],
    hasMore: false,
  });
  expect((await invokeTool("read_channel", {}, member.id, true)).messages).toEqual([]);
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

  const deliver = runtime.deliverSessionMessage;

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
  await editChannelTasks(channel.id, {
    operations: [{ type: "add", task: tasks[0] }],
  });
  expect(await channels.getChannel(channel.id)).toMatchObject({
    latestSequence: beforeTasks.latestSequence,
    updatedAt: beforeTasks.updatedAt,
  });
  await updateChannel(channel.id, {
    preview: { kind: "url", url: "http://localhost:3000" },
  });
  const model = { provider: "copilot", name: "gpt-6" };
  await editChannel({ channelId: channel.id, model });
  await markChannelRead(channel.id, 100);
  expect((await markChannelRead(channel.id, 1))?.seenThrough).toBe(4);
  await updateChannel(channel.id, {
    tasks: [...tasks],
    preview: { kind: "url", url: "http://localhost:3000" },
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
  expect(await updateChannel(channel.id, { directory: nextDirectory })).toMatchObject({
    directory: nextDirectory,
  });
  await expect(stat(nextDirectory)).rejects.toThrow();
  await updateChannel(channel.id, { directory: nextDirectory });
  expect(await updateChannel(channel.id, { directory: null })).toMatchObject({
    directory: undefined,
  });
  expect(events.map((event) => event.type)).toEqual(["message", "message"]);
  expect(updates).toEqual([nextDirectory, ""]);
});

test("a lead is nudged toward an avatar until it sets one", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Avatars", ...CHANNEL_DEFAULTS });
  onTestFinished(() => deleteChannelFiles(channel.id));
  const directory = await mkdtemp(join(tmpdir(), "toy-box-channel-avatar-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  runtime.getSessionDirectory.mockResolvedValue(directory);
  const { getChannelAgentConfiguration } = await import("./agent");
  const nudged = async (channelId: string, sessionId = channelId) =>
    (
      await getChannelAgentConfiguration(channelAgent(channelId, sessionId, "Builder"))
    ).additionalInstructions.includes("give this channel an avatar");
  const unstated = await createStoredChannel(channels, {
    name: "Unstated",
    model: CHANNEL_DEFAULTS.model,
  });
  expect([await nudged(channel.id), await nudged(channel.id, "member")]).toEqual([true, false]);
  expect(await nudged(unstated.id)).toBe(false);

  await Bun.write(join(directory, "icon.png"), "icon");
  await invokeTool("update_channel", { avatar: { image: "icon.png" } }, channel.id);
  expect(await nudged(channel.id)).toBe(false);
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

test("member model overrides can be cleared but cannot change an established provider", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Models", ...CHANNEL_DEFAULTS });
  const { member } = await channels.createMember(channelAgent(channel.id, "builder", "Builder"));
  onTestFinished(() => releaseChannelEvents(channel.id));
  const model = { provider: "claude", name: "sonnet" };

  // Before a session exists, an explicit override may select any provider.
  expect(await updateChannelMember({ agentId: member.id, model })).toMatchObject({ model });
  await setSessionProvider(member.id, { id: model.provider, sessionId: member.id });
  await expect(
    updateChannelMember({
      agentId: member.id,
      model: { provider: "copilot", name: "gpt-5.5" },
    }),
  ).rejects.toThrow("A member's provider cannot change without losing its session history.");
  expect((await channels.getMember(member.id))?.model).toEqual(model);

  const replacement = { ...model, name: "opus" };
  expect(await updateChannelMember({ agentId: member.id, model: replacement })).toMatchObject({
    model: replacement,
  });
  expect(await updateChannelMember({ agentId: member.id, model: null })).not.toHaveProperty(
    "model",
  );
});

test("a member's provider comes from its session, else its configured model", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Models", ...CHANNEL_DEFAULTS });
  const other = await createStoredChannel(channels, { name: "Other", ...CHANNEL_DEFAULTS });
  const { member } = await channels.createMember(channelAgent(channel.id, "builder", "Builder"));
  onTestFinished(() => releaseChannelEvents(channel.id));

  expect(await getChannelMemberProvider(channel.id, member.id)).toBeNull();
  await channels.updateMember(member.id, { model: { provider: "claude", name: "sonnet" } });
  expect(await getChannelMemberProvider(channel.id, member.id)).toBe("claude");
  await setSessionProvider(member.id, { id: "codex", sessionId: member.id });
  expect(await getChannelMemberProvider(channel.id, member.id)).toBe("codex");
  // The lead is never a member, and a member belongs to only its own Channel.
  expect(await getChannelMemberProvider(channel.id, channel.id)).toBeUndefined();
  expect(await getChannelMemberProvider(other.id, member.id)).toBeUndefined();
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
  await setChannelMessageReaction(member.id, {
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
  setSessionActivity(member.id, "running");
  onTestFinished(() => {
    deleteSessionActivity(member.id);
    deleteSessionActivity(waiting.id);
    deleteSessionActivity(channel.id);
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
    setSessionActivity(member.id, status);
    await cleared.promise;
    unsubscribe();
    expect((await channels.getAgent(member.id))?.status).toBeUndefined();
  }
  setSessionActivity(waiting.id, "idle");
  await setChannelAgentStatus(member.id, { status: "Old turn" });
  setSessionActivity(member.id, "idle");
  setSessionActivity(member.id, "running");
  await setChannelAgentStatus(member.id, { status: "New turn" });
  expect((await channels.getAgent(member.id))?.status).toEqual({
    state: "working",
    text: "New turn",
  });
  expect((await channels.getAgent(waiting.id))?.status).toEqual(wait);
  expect(events.every(({ type }) => type === "status")).toBe(true);
});

function spyOnDelivery() {
  const broadcasts = spyOn(workspaceEvents, "broadcast").mockImplementation(() => {});
  onTestFinished(() => broadcasts.mockRestore());
  return runtime.deliverSessionMessage;
}

test("check-ins privately notify the assignee per task and publish the consumed snapshot once", async () => {
  setSystemTime(new Date("2026-10-23T15:00:00.000Z"));
  onTestFinished(() => setSystemTime());
  const checkInAt = "2026-10-23T15:05:00.000Z";
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Check-ins", ...CHANNEL_DEFAULTS });
  const { member } = await channels.createMember(channelAgent(channel.id, "builder", "Builder"));
  await editChannelTasks(channel.id, {
    operations: ["build", "verify"].map((id) => ({
      type: "add" as const,
      task: { id, title: id, status: "in_progress", ownerId: member.id, checkInAt },
    })),
  });
  const before = await getChannelSnapshot(channel.id);
  const events: ChannelEvent[] = [];
  const unsubscribe = subscribeChannelEvents(channel.id, (event) => events.push(event));
  onTestFinished(() => {
    unsubscribe();
    releaseChannelEvents(channel.id);
  });
  const deliver = spyOnDelivery();
  await wakeDueChannelAgents(new Date(checkInAt));
  await wakeDueChannelAgents(new Date("2026-10-23T15:06:00.000Z"));
  expect(deliver.mock.calls).toEqual(
    ["build", "verify"].map((id) => [
      member.id,
      {
        immediate: true,
        systemMessage: {
          type: "channel_task_check_in",
          taskId: id,
          title: id,
          checkInAt,
        },
      },
    ]),
  );
  expect(events.map(({ type }) => type)).toEqual(["tasks"]);
  const after = await getChannelSnapshot(channel.id);
  expect(events.reduce(reduceChannelState, before!)).toEqual(after!);
});

test.each(["lead", "member"] as const)(
  "a %s follow-up privately wakes it once when due",
  async (role) => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, { name: "Deploy", ...CHANNEL_DEFAULTS });
    const agentId =
      role === "lead"
        ? channel.id
        : (await channels.createMember(channelAgent(channel.id, "builder", "Builder"))).member.id;
    const deliver = spyOnDelivery();
    setSystemTime(new Date("2026-09-29T15:00:00.000Z"));
    onTestFinished(() => setSystemTime());

    await finishChannelAgentTurn(agentId, "CI to finish", 20);
    expect((await channels.getAgent(agentId))?.status).toEqual({
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
        agentId,
        {
          systemMessage: { type: "channel_follow_up", waitingFor: "CI to finish" },
          immediate: true,
        },
      ],
    ]);
    expect((await channels.getAgent(agentId))?.status).toBeUndefined();
  },
);

test.each(["lead", "member"] as const)(
  "a message that wakes the %s first cancels its follow-up",
  async (role) => {
    const channels = await openChannels();
    const channel = await createStoredChannel(channels, { name: "Deploy", ...CHANNEL_DEFAULTS });
    const agentId =
      role === "lead"
        ? channel.id
        : (await channels.createMember(channelAgent(channel.id, "builder", "Builder"))).member.id;
    const deliver = spyOnDelivery();

    await finishChannelAgentTurn(agentId, "CI to finish", 20);
    await postChannelMessage(
      {
        id: "update",
        channelId: channel.id,
        content: role === "lead" ? "CI passed." : "@builder CI passed.",
      },
      { type: "user" },
    );
    await wakeDueChannelAgents(new Date(Date.now() + 30 * 60_000));

    expect(deliver.mock.calls).toEqual([
      [
        agentId,
        { systemMessage: { type: "channel_message", senderName: "the user" }, immediate: true },
      ],
    ]);
  },
);

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

  const routine = await setChannelRoutine(channel.id, {
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

test("a lead privately wakes another channel's lead and only a channel's lead", async () => {
  const channels = await openChannels();
  const sender = await createStoredChannel(channels, { name: "Core", ...CHANNEL_DEFAULTS });
  const target = await createStoredChannel(channels, { name: "Apple", ...CHANNEL_DEFAULTS });
  const deliver = spyOnDelivery();

  for (const [channelId, error] of [
    ["user-session", "Channel not found."],
    [sender.id, "Message another channel's lead, not your own."],
  ]) {
    await expect(
      messageChannelLead(sender.id, { channelId: channelId!, content: "Ping" }),
    ).rejects.toThrow(error);
  }
  expect(deliver).not.toHaveBeenCalled();

  await messageChannelLead(sender.id, { channelId: target.id, content: "Which build?" });
  expect(deliver.mock.calls).toEqual([
    [
      target.id,
      {
        systemMessage: {
          type: "channel_lead_message",
          channelId: sender.id,
          channelName: "Core",
          content: "Which build?",
        },
        immediate: true,
      },
    ],
  ]);
  expect((await channels.getChannel(sender.id))?.latestSequence).toBe(sender.latestSequence);
  expect((await channels.getChannel(target.id))?.latestSequence).toBe(target.latestSequence);
});

test("a lead's message to a channel this server doesn't hold goes once to its peer server, naming the sender's channel and server", async () => {
  const channels = await openChannels();
  const sender = await createStoredChannel(channels, { name: "Core", ...CHANNEL_DEFAULTS });
  const deliveries: unknown[] = [];
  const studio = servePeer(
    toyBoxServer(
      "Studio",
      channelCatalog([{ id: "apple", name: "Apple" }], async (request) => {
        deliveries.push({ path: new URL(request.url).pathname, body: await request.json() });
        return new Response(null, { status: deliveries.length === 1 ? 204 : 422 });
      }),
    ),
  );
  setPeers(studio.href);
  const deliver = spyOnDelivery();
  const message = (channelId: string, content: string) =>
    messageChannelLead(sender.id, { channelId, content });

  await message("apple", "Which build?");
  await expect(message("apple", "Still there?")).rejects.toThrow("Couldn't deliver to Studio.");
  await expect(message("pear", "Hi")).rejects.toThrow("Channel not found.");
  const path = "/api/v1/channels/apple/lead-messages";
  const from = { from: sender.id, channelName: "Core", server: (await getServer()).name };
  expect(deliveries).toEqual([
    { path, body: { ...from, content: "Which build?" } },
    { path, body: { ...from, content: "Still there?" } },
  ]);
  expect(deliver).not.toHaveBeenCalled();
});

test("running a routine wakes its lead now and leaves its schedule alone", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Watch", ...CHANNEL_DEFAULTS });
  const deliver = spyOnDelivery();
  const routine = await setChannelRoutine(channel.id, {
    title: "CI",
    schedule: "0 * * * *",
    prompt: "Check CI",
  });
  const wake: Parameters<typeof realRuntime.deliverSessionMessage> = [
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
