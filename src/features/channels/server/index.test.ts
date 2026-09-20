import { expect, mock, onTestFinished, spyOn, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelEvent } from "@channels/model";
import type { Worker } from "@workers/model";
import { createTestDatabase } from "@/server/database";
import * as sessions from "@sessions/server/providers";
import * as sessionRuntime from "@sessions/server/runtime";

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
  createChannelMembersFromAgent,
  finishChannelAgentTurn,
  postChannelMessageFromSession,
  readChannelForSession,
  sendChannelMessageFromAgent,
  setChannelAgentStatus,
  setChannelMessageReactionFromAgent,
  shareChannelArtifactFromSession,
  streamChannel,
} = await import("./index");
const { publishChannelEvent, releaseChannelEvents } = await import("./events");

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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

test("creating a Channel creates its workspace directory", async () => {
  currentDb = await createTestDatabase();
  const root = await mkdtemp(join(tmpdir(), "toy-box-channel-create-"));
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
    await rm(root, { recursive: true, force: true });
  });
  const directory = join(root, "nested", "workspace");

  const channel = await createChannel({ title: "Bitmap studio", directory });

  expect(channel.directory).toBe(directory);
  expect((await stat(directory)).isDirectory()).toBe(true);
});

test("an addressed Channel post settles after its Agent wake is ready", async () => {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
  });

  const channels = new ChannelDatabase(currentDb);
  const channel = await channels.createChannel({ title: "Coordination" });
  const { member } = await channels.createMember(
    channelAgent(channel.id, "reviewer-session", "Reviewer"),
  );
  await channels.setMemberStatus(member, { state: "waiting", text: "a review request" });
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
  currentDb = await createTestDatabase();
  const directory = await mkdtemp(join(tmpdir(), "toy-box-channel-message-"));
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  const channels = new ChannelDatabase(currentDb);
  const channel = await channels.createChannel({ title: "Visual review" });
  const sessionId = "designer-session";
  await channels.createMember(channelAgent(channel.id, sessionId, "Designer"));
  const screenshot = join(directory, "screenshot.png");
  await Bun.write(screenshot, Buffer.from(PNG_BASE64, "base64"));

  const message = await sendChannelMessageFromAgent(sessionId, {
    content: "The layout is ready for review.",
    attachmentPaths: [screenshot],
  });

  expect(message).toMatchObject({
    sequence: 2,
    sender: { type: "agent", agentId: sessionId },
    content: "The layout is ready for review.",
    attachments: [screenshot],
  });
  expect((await channels.listMessagesAfter(channel.id)).at(-1)).toEqual(message);
});

test("a Channel Agent can create peers in its own Channel", async () => {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
  });

  const channels = new ChannelDatabase(currentDb);
  const channel = await channels.createChannel({ title: "Product studio" });
  const { member: creator } = await channels.createMember(
    channelAgent(channel.id, "strategist-session", "Strategist"),
  );

  const peers = await createChannelMembersFromAgent(creator.id, [
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
    "Strategist",
  ]);
  expect((await channels.listMessagesAfter(channel.id)).at(-1)).toMatchObject({
    sender: { type: "system" },
    content: { type: "member_joined", member: { id: peers[1]!.id } },
  });
});

test("a Session can seed and passively read Channel context", async () => {
  const getDirectory = spyOn(sessions, "getSessionDirectory").mockResolvedValue(undefined);
  onTestFinished(() => getDirectory.mockRestore());
  currentDb = await createTestDatabase();
  const directory = await mkdtemp(join(tmpdir(), "toy-box-channel-session-"));
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  const channels = new ChannelDatabase(currentDb);
  const channel = await channels.createChannel({
    title: "Research",
    directory,
  });
  await Promise.all([
    Bun.write(join(directory, "evidence.png"), Buffer.from(PNG_BASE64, "base64")),
    Bun.write(join(directory, "brief.md"), "# Brief"),
  ]);

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

  const result = await readChannelForSession(channel.id);
  expect(result).toMatchObject({
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
    ],
    artifacts: [{ path: join(directory, "brief.md"), title: "Research brief" }],
    hasMore: false,
  });
  expect((await channels.getChannel(channel.id))?.seenThrough).toBe(0);
  expect(await readChannelForSession(channel.id, message.sequence + 1)).toMatchObject({
    messages: [{ id: "kickoff" }],
    hasMore: false,
  });
});

test("a Channel Agent publishes focus and settles temporary turn state", async () => {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
  });

  const channels = new ChannelDatabase(currentDb);
  const channel = await channels.createChannel({ title: "Protocol review" });
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
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
  });

  const channels = new ChannelDatabase(currentDb);
  const channel = await channels.createChannel({ title: "Planning" });
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
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
  });

  const channels = new ChannelDatabase(currentDb);
  const channel = await channels.createChannel({ title: "Long-running room" });
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
