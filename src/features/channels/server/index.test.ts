import { channelAgent, createStoredChannel } from "@channels/server/testFixtures";
import { beforeEach, expect, mock, onTestFinished, spyOn, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelEvent } from "@channels/model";
import { createTestDatabase } from "@/server/database";
import * as sessions from "@sessions/server/providers";
import * as sessionRuntime from "@sessions/server/runtime";
import * as workspaceEvents from "@workspace/server/events";

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
  createChannelMember,
  createChannelMembersFromLead,
  editChannel,
  finishChannelAgentTurn,
  markChannelDoneFromLead,
  requestChannelUserAttentionFromLead,
  postChannelMessageFromSession,
  readChannelForSession,
  sendChannelMessageFromAgent,
  setChannelAgentStatus,
  setChannelMessageReactionFromAgent,
  shareChannelArtifactFromSession,
  streamChannel,
  updateChannelMember,
  updateChannelFromLead,
} = await import("./index");
const { publishChannelEvent, releaseChannelEvents } = await import("./events");
const { getChannelAgentConfiguration } = await import("./agent");
const { channelMemberTools, channelTools } = await import("./tools");

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

test("attention uses normal messages and upserts, and a user reply also wakes the lead", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, { name: "Attention", ...CHANNEL_DEFAULTS });
  const { member } = await channels.createMember(channelAgent(channel.id, "builder", "Builder"));
  const events: ChannelEvent[] = [];
  const unsubscribe = await streamChannel(channel.id, 1, (event) => events.push(event));
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
  });
  const notice = await requestChannelUserAttentionFromLead(channel.id, request.sequence);
  const done = await markChannelDoneFromLead(channel.id);
  expect(events.filter((event) => event.type === "message").map(({ message }) => message)).toEqual([
    request,
    notice,
    done,
  ]);
  expect(broadcasts.mock.calls.map(([event]) => event.type)).toEqual([
    "channel.upserted",
    "channel.upserted",
    "channel.upserted",
  ]);
  expect(broadcasts.mock.lastCall?.[0]).toMatchObject({
    channel: { hasPendingRequest: true, hasUnreadCompletion: true },
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
  expect((await channels.getChannel(channel.id))?.hasPendingRequest).toBe(false);
  expect((await channels.getAgent(channel.id))?.status).toBeUndefined();
});

test("only leads receive nonterminal attention tools", async () => {
  const channels = await openChannels();
  const channel = await createStoredChannel(channels, {
    name: "Protocol",
    model: CHANNEL_DEFAULTS.model,
  });
  const configuration = await getChannelAgentConfiguration(
    channelAgent(channel.id, channel.id, "Lead"),
  );
  for (const name of ["mark_channel_done", "request_user_attention"]) {
    const tool = configuration.tools.find((tool) => tool.name === name);
    expect(tool).toBeDefined();
    expect(tool?.isTerminal).not.toBe(true);
    expect([...channelMemberTools, ...channelTools].some((tool) => tool.name === name)).toBe(false);
  }
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

test("an addressed Channel post settles after its Agent wake is ready", async () => {
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
  const post = postChannelMessageFromSession("coordinator-session", {
    id: "review-request",
    channelId: channel.id,
    content: "@reviewer please inspect this.",
  }).then(() => {
    settled = true;
  });
  await wakeStarted;
  expect(settled).toBe(false);
  releaseWake();
  await post;
  expect(settled).toBe(true);
  expect((await channels.getMember(member.id))?.status).toBeUndefined();
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
  expect((await channels.listMessagesAfter(channel.id)).at(-1)).toMatchObject({
    sender: { type: "system" },
    content: { type: "member_joined", member: { id: peers[1]!.id } },
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
  await shareChannelArtifactFromSession("coordinator-session", {
    channelId: channel.id,
    path: "brief.md",
    title: "Research brief",
  });
  await updateChannelFromLead(channel.id, {
    purpose: "Turn the evidence into a useful recommendation.",
    checklist: [{ title: "Synthesize the evidence", status: "in_progress" }],
    previewUrl: "http://127.0.0.1:3000",
  });

  const result = await readChannelForSession(channel.id);
  expect(result).toMatchObject({
    channel: {
      purpose: "Turn the evidence into a useful recommendation.",
      checklist: [{ title: "Synthesize the evidence", status: "in_progress" }],
      previewUrl: "http://127.0.0.1:3000",
    },
    members: [],
    messages: [
      {
        id: "kickoff",
        sender: { type: "user" },
        attachments: [join(directory, "evidence.png")],
      },
      {
        sender: { type: "system" },
        content: {
          type: "artifact_shared",
          artifact: { title: "Research brief" },
        },
      },
      {
        sender: { type: "system" },
        content: {
          type: "channel_purpose_changed",
          actor: { type: "agent", agentId: channel.id },
          purpose: "Turn the evidence into a useful recommendation.",
        },
      },
    ],
    artifacts: [{ path: join(directory, "brief.md"), title: "Research brief" }],
    hasMore: false,
  });
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

test("user channel edits publish separate messages and notify the lead once for a new purpose", async () => {
  const channels = await openChannels();
  const { subscribeChannelEvents, releaseChannelEvents } = await import("./events");
  const { subscribeWorkspaceEvents } = await import("@workspace/server/events");
  const channel = await createStoredChannel(channels, { name: "Planning", ...CHANNEL_DEFAULTS });
  const channelEvents: ChannelEvent[] = [];
  const workspaceUpdates: string[] = [];
  onTestFinished(subscribeChannelEvents(channel.id, (event) => channelEvents.push(event)));
  onTestFinished(() => releaseChannelEvents(channel.id));
  onTestFinished(
    subscribeWorkspaceEvents((event) => {
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
  expect(deliver).toHaveBeenCalledTimes(1);
});

test("a lead directory assignment only saves metadata and publishes real changes", async () => {
  const channels = await openChannels();
  const root = await mkdtemp(join(tmpdir(), "toy-box-channel-directory-"));
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const { subscribeChannelEvents } = await import("./events");
  const { subscribeWorkspaceEvents } = await import("@workspace/server/events");
  const channel = await createStoredChannel(channels, { name: "Planning", ...CHANNEL_DEFAULTS });
  const { member } = await channels.createMember(
    channelAgent(channel.id, "builder-session", "Builder"),
  );
  const events: ChannelEvent[] = [];
  const updates: string[] = [];
  onTestFinished(subscribeChannelEvents(channel.id, (event) => events.push(event)));
  onTestFinished(() => releaseChannelEvents(channel.id));
  onTestFinished(
    subscribeWorkspaceEvents((event) => {
      if (event.type === "channel.upserted" && event.channel.id === channel.id) {
        updates.push(event.channel.directory ?? "");
      }
    }),
  );
  const nextDirectory = join(root, "nested", "workspace");
  const unauthorized = join(root, "unauthorized");

  await expect(updateChannelFromLead(member.id, { directory: unauthorized })).rejects.toThrow(
    "Only the channel lead",
  );
  await expect(stat(unauthorized)).rejects.toThrow();
  expect(await updateChannelFromLead(channel.id, { directory: nextDirectory })).toEqual({
    name: channel.name,
    purpose: CHANNEL_DEFAULTS.purpose,
    directory: nextDirectory,
    checklist: [],
    previewUrl: undefined,
  });
  await expect(stat(nextDirectory)).rejects.toThrow();
  await updateChannelFromLead(channel.id, { directory: nextDirectory });
  expect(await updateChannelFromLead(channel.id, { directory: null })).toEqual({
    name: channel.name,
    purpose: CHANNEL_DEFAULTS.purpose,
    checklist: [],
    directory: undefined,
    previewUrl: undefined,
  });
  expect(events.map((event) => event.type)).toEqual(["message", "message"]);
  expect(updates).toEqual([nextDirectory, ""]);
});

test("editing member metadata publishes a roster change only when something changed", async () => {
  const channels = await openChannels();
  const { subscribeChannelEvents } = await import("./events");
  const { subscribeWorkspaceEvents } = await import("@workspace/server/events");
  const channel = await createStoredChannel(channels, { name: "Review", ...CHANNEL_DEFAULTS });
  const { member } = await channels.createMember(
    channelAgent(channel.id, "reviewer-session", "Reviewer"),
  );
  const events: ChannelEvent[] = [];
  let rosterChanges = 0;
  onTestFinished(subscribeChannelEvents(channel.id, (event) => events.push(event)));
  onTestFinished(() => releaseChannelEvents(channel.id));
  onTestFinished(
    subscribeWorkspaceEvents((event) => {
      if (event.type === "channel.members.changed") rosterChanges++;
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
  const second = await channels.appendMessage({
    id: "message-2",
    channelId: channel.id,
    sender: { type: "user" },
    content: "Implement the revision.",
  });
  const third = await channels.appendMessage({
    id: "message-3",
    channelId: channel.id,
    sender: { type: "user" },
    content: "Keep this decision.",
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
    workingOn: second.message.sequence,
  });
  await setChannelMessageReactionFromAgent(member.id, {
    sequence: third.message.sequence,
    reaction: "love",
  });
  await finishChannelAgentTurn(member.id, "implementation feedback");

  expect(await channels.getMember(member.id)).toMatchObject({
    status: { state: "waiting", text: "implementation feedback" },
  });
  const messages = await channels.listMessagesAfter(channel.id);
  expect(messages.find(({ id }) => id === first.message.id)?.reactions).toBeUndefined();
  expect(messages.find(({ id }) => id === second.message.id)?.reactions).toBeUndefined();
  expect(messages.find(({ id }) => id === third.message.id)?.reactions).toEqual([
    { agentId: member.id, reaction: "love" },
  ]);
  expect(await readChannelForSession(channel.id)).toMatchObject({
    members: [
      {
        memberId: member.id,
        status: { state: "waiting", text: "implementation feedback" },
      },
    ],
  });

  await setChannelAgentStatus(member.id, { status: "Checking the revision" });
  await finishChannelAgentTurn(member.id);
  expect((await channels.getMember(member.id))?.status).toBeUndefined();
});

test("a Channel stream orders and deduplicates published transitions", async () => {
  const channels = await openChannels();

  const channel = await createStoredChannel(channels, { name: "Planning", ...CHANNEL_DEFAULTS });
  const received: number[] = [];
  const unsubscribe = await streamChannel(channel.id, 0, (event) => {
    received.push(event.revision);
  });
  onTestFinished(() => {
    unsubscribe();
    releaseChannelEvents(channel.id);
  });

  const first = await channels.appendMessage({
    id: "first",
    channelId: channel.id,
    sender: { type: "user" },
    content: "First",
  });
  const second = await channels.appendMessage({
    id: "second",
    channelId: channel.id,
    sender: { type: "user" },
    content: "Second",
  });
  const firstEvent = {
    type: "message",
    revision: first.revision,
    message: first.message,
  } as const;
  const secondEvent = {
    type: "message",
    revision: second.revision,
    message: second.message,
  } as const;
  publishChannelEvent(channel.id, secondEvent);
  publishChannelEvent(channel.id, secondEvent);
  publishChannelEvent(channel.id, firstEvent);

  expect(received).toEqual([first.revision, second.revision]);
});

test("a Channel stream recovers with bounded latest history", async () => {
  const channels = await openChannels();

  const channel = await createStoredChannel(channels, {
    name: "Long-running room",
    ...CHANNEL_DEFAULTS,
  });
  for (let sequence = 1; sequence <= 101; sequence++) {
    await channels.appendMessage({
      id: `message-${sequence}`,
      channelId: channel.id,
      sender: { type: "user" },
      content: `Message ${sequence}`,
    });
  }

  const events: ChannelEvent[] = [];
  const unsubscribe = await streamChannel(channel.id, 0, (event) => events.push(event));
  onTestFinished(() => {
    unsubscribe();
    releaseChannelEvents(channel.id);
  });

  const event = events[0];
  if (event?.type !== "state") throw new Error("Expected state recovery.");
  expect(events).toHaveLength(1);
  expect(event.state.messages).toHaveLength(100);
  expect(event.state.messages[0]?.sequence).toBe(2);
  expect(event.state.messages.at(-1)?.sequence).toBe(101);
});
