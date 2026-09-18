import { expect, mock, onTestFinished, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelEvent } from "@channels/model";
import { createTestDatabase } from "@/server/database";
import * as sessions from "@sessions/server/providers";

let currentDb: Bun.SQL | undefined;

mock.module("@/server/database", () => ({
  getStateDatabase: async () => {
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const { AgentDatabase } = await import("@agents/server/database");
const agentSupervisor = await import("@agents/server/supervisor");
const { ChannelDatabase } = await import("./database");
const {
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

test("an addressed Channel post settles after its Agent wake is ready", async () => {
  currentDb = await createTestDatabase();
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
  });

  const channels = new ChannelDatabase(currentDb);
  const channel = await channels.createChannel({ title: "Coordination" });
  await new AgentDatabase(currentDb).createAgent({ name: "Reviewer" });
  let releaseWake!: () => void;
  let announceWake!: () => void;
  const wakeStarted = new Promise<void>((resolve) => {
    announceWake = resolve;
  });
  const wakeFinished = new Promise<void>((resolve) => {
    releaseWake = resolve;
  });
  const mention = spyOn(agentSupervisor, "mentionAgent").mockImplementation(() => {
    announceWake();
    return wakeFinished;
  });
  onTestFinished(() => mention.mockRestore());

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
  const agent = await new AgentDatabase(currentDb).createAgent({
    name: "Designer",
  });
  const sessionId = "designer-session";
  await channels.createMember({
    channelId: channel.id,
    agentId: agent.id,
    sessionId,
  });
  const screenshot = join(directory, "screenshot.png");
  await Bun.write(screenshot, Buffer.from(PNG_BASE64, "base64"));

  const message = await sendChannelMessageFromAgent(sessionId, {
    content: "The layout is ready for review.",
    attachmentPaths: [screenshot],
  });

  expect(message).toMatchObject({
    sequence: 2,
    sender: { type: "agent", agentId: agent.id },
    content: "The layout is ready for review.",
    attachments: [screenshot],
  });
  expect((await channels.listMessagesAfter(channel.id)).at(-1)).toEqual(message);
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
  const agent = await new AgentDatabase(currentDb).createAgent({ name: "Reviewer" });
  const { member } = await channels.createMember({
    channelId: channel.id,
    agentId: agent.id,
    sessionId: "reviewer-session",
  });
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

  await setChannelAgentStatus(member.sessionId, {
    status: "Reviewing the protocol",
    lookingAt: first.message.sequence,
  });
  expect(await channels.getMemberBySession(member.sessionId)).toMatchObject({
    status: {
      state: "working",
      text: "Reviewing the protocol",
      lookingAt: first.message.sequence,
    },
  });
  await setChannelAgentStatus(member.sessionId, {
    status: "Implementing the revision",
    workingOn: second.message.sequence,
  });
  await setChannelMessageReactionFromAgent(member.sessionId, {
    sequence: third.message.sequence,
    reaction: "love",
  });
  await finishChannelAgentTurn(member, "implementation feedback");

  expect(await channels.getMemberBySession(member.sessionId)).toMatchObject({
    status: { state: "waiting", text: "implementation feedback" },
  });
  const messages = await channels.listMessagesAfter(channel.id);
  expect(messages.find(({ id }) => id === first.message.id)?.reactions).toBeUndefined();
  expect(messages.find(({ id }) => id === second.message.id)?.reactions).toBeUndefined();
  expect(messages.find(({ id }) => id === third.message.id)?.reactions).toEqual([
    { agentId: agent.id, reaction: "love" },
  ]);
  expect(await readChannelForSession(channel.id)).toMatchObject({
    members: [
      {
        agentId: agent.id,
        status: { state: "waiting", text: "implementation feedback" },
      },
    ],
  });

  await setChannelAgentStatus(member.sessionId, { status: "Checking the revision" });
  await finishChannelAgentTurn(member);
  expect((await channels.getMemberBySession(member.sessionId))?.status).toBeUndefined();
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
