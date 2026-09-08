import { expect, mock, onTestFinished, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "@/server/database";

let currentDb: Bun.SQL | undefined;

mock.module("@/server/database", () => ({
  getStateDatabase: async () => {
    if (!currentDb) throw new Error("Test database has not been opened");
    return currentDb;
  },
}));

const { AgentDatabase } = await import("@agents/server/database");
const { ChannelDatabase } = await import("./database");
const {
  postChannelMessageFromSession,
  readChannelForSession,
  sendChannelMessageFromAgent,
  shareChannelArtifactFromSession,
  streamChannel,
} = await import("./index");
const { publishChannelEvent, releaseChannelEvents } = await import("./events");

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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
  const agent = await new AgentDatabase(currentDb).createAgent({ name: "Designer" });
  const sessionId = "designer-session";
  await channels.createMember({
    channelId: channel.id,
    agentId: agent.id,
    sessionId,
    executionMode: "shared",
  });
  const screenshot = join(directory, "screenshot.png");
  await Bun.write(screenshot, Buffer.from(PNG_BASE64, "base64"));

  const message = await sendChannelMessageFromAgent(sessionId, {
    content: "The layout is ready for review.",
    attachmentPaths: [screenshot],
  });

  expect(message).toMatchObject({
    sequence: 1,
    sender: { type: "agent", agentId: agent.id },
    content: "The layout is ready for review.",
    attachments: [{ displayName: "screenshot.png", mimeType: "image/png", base64: PNG_BASE64 }],
    reactions: [],
  });
  expect(await channels.listMessages(channel.id)).toEqual([message]);
});

test("a Session can seed and passively read Channel context", async () => {
  currentDb = await createTestDatabase();
  const directory = await mkdtemp(join(tmpdir(), "toy-box-channel-session-"));
  onTestFinished(async () => {
    await currentDb?.close();
    currentDb = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  const channels = new ChannelDatabase(currentDb);
  const channel = await channels.createChannel({ title: "Research", directory });
  await Promise.all([
    Bun.write(join(directory, "evidence.png"), Buffer.from(PNG_BASE64, "base64")),
    Bun.write(join(directory, "brief.md"), "# Brief"),
  ]);

  const message = await postChannelMessageFromSession("coordinator-session", {
    id: "kickoff",
    channelId: channel.id,
    content: "Review the evidence and brief.",
    attachmentPaths: ["evidence.png"],
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
        attachments: [{ displayName: "evidence.png", mimeType: "image/png" }],
      },
    ],
    artifacts: [{ path: join(directory, "brief.md"), title: "Research brief" }],
    hasMore: false,
  });
  expect((await channels.getChannel(channel.id))?.seenThrough).toBe(0);
  expect(await readChannelForSession(channel.id, message.sequence)).toMatchObject({
    messages: [],
    hasMore: false,
  });
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
    received.push(event.cursor);
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
    cursor: first.cursor,
    message: first.message,
  } as const;
  const secondEvent = {
    type: "message",
    cursor: second.cursor,
    message: second.message,
  } as const;
  publishChannelEvent(channel.id, secondEvent);
  publishChannelEvent(channel.id, secondEvent);
  publishChannelEvent(channel.id, firstEvent);

  expect(received).toEqual([first.cursor, second.cursor]);
});
