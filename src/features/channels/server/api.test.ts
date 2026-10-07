import { expect, onTestFinished, spyOn, test } from "bun:test";
import type { ChannelMessage, ChannelObservationEvent } from "@channels/model";
import { broadcast } from "@workspace/server/events";
import { setSessionStatus } from "@workspace/server/state";
import { deleteSessionState } from "@workspace/server/state/sessions";
import * as database from "@/server/database";
import {
  getChannelHistoryResponse,
  getChannelResponse,
  markChannelReadResponse,
  postChannelMessageResponse,
} from "./api";
import { ChannelDatabase } from "./database";
import { resolveEventResources } from "./resources";
import { publishChannelEvent, releaseChannelEvents } from "./events";
import { getChannelSnapshot, streamChannel } from "./stream";
import { channelAgent, createStoredChannel } from "./testFixtures";

async function openChannel() {
  const db = await database.createTestDatabase();
  const access = spyOn(database, "getStateDatabase").mockResolvedValue(db);
  const channels = new ChannelDatabase(db);
  const channel = await createStoredChannel(channels, {
    name: "Studio",
    model: { provider: "copilot", name: "gpt-5.5" },
  });
  onTestFinished(async () => {
    access.mockRestore();
    releaseChannelEvents(channel.id);
    deleteSessionState(channel.id);
    await db.close();
  });
  return { channel, channels };
}

function observe(channelId: string, afterRevision?: number) {
  const events: ChannelObservationEvent[] = [];
  const waiters: Array<(event: ChannelObservationEvent) => void> = [];
  let closed = false;
  const stop = streamChannel(
    channelId,
    (event) => {
      const waiter = waiters.shift();
      if (waiter) waiter(event);
      else events.push(event);
    },
    () => {
      closed = true;
    },
    afterRevision,
  );
  onTestFinished(stop);
  return {
    stop,
    events,
    get closed() {
      return closed;
    },
    next(): Promise<ChannelObservationEvent> {
      const event = events.shift();
      return event ? Promise.resolve(event) : new Promise((resolve) => waiters.push(resolve));
    },
  };
}

test("snapshots combine public Channel facts with live presence without exposing private worker metadata", async () => {
  const { channel, channels } = await openChannel();
  const worker = channelAgent(channel.id, "reviewer", "Reviewer");
  worker.metadata = { seenThrough: 72 };
  const { member } = await channels.createMember(worker);
  onTestFinished(() => deleteSessionState(member.id));
  setSessionStatus(channel.id, "running");

  const file = { kind: "session" as const, sessionId: channel.id, path: "docs/Project plan.md" };
  await channels.shareArtifact({
    channelId: channel.id,
    file,
    title: "Plan",
    actor: { type: "user" },
  });
  const attachments = ["/tmp/a #1.png", { mimeType: "image/png", base64: "AAEC" }, "/tmp/last.png"];
  await channels.appendMessage({
    request: true,
    id: "images",
    channelId: channel.id,
    sender: { type: "agent", agentId: channel.id },
    content: "See these images",
    attachments,
  });
  const snapshot = await getChannelSnapshot(channel.id);
  const artifact = {
    id: `session:${channel.id}:docs/Project plan.md`,
    url: `/api/serve/${channel.id}/docs/Project%20plan.md`,
  };
  expect(snapshot?.artifacts[0]).toMatchObject({ ...artifact, file, title: "Plan" });
  // Live shares carry the same identity, so clients match task outcomes either way.
  const share = snapshot?.messages.find(
    ({ content }) => typeof content === "object" && content.type === "artifact_shared",
  );
  expect(share).toMatchObject({ content: { artifact } });
  expect<ChannelMessage | null | undefined>(snapshot?.request).toEqual(
    snapshot?.messages.find(({ id }) => id === "images"),
  );
  expect(snapshot?.request).toMatchObject({
    attachments: [
      { name: "a #1.png", url: "/api/serve/machine/tmp/a%20%231.png" },
      { mimeType: "image/png", base64: "AAEC" },
      { name: "last.png", url: "/api/serve/machine/tmp/last.png" },
    ],
  });
  expect(snapshot).toMatchObject({
    channel: { id: channel.id, name: "Studio" },
    members: [{ id: member.id, name: "Reviewer" }],
    presence: { [channel.id]: { state: "working" }, [member.id]: { state: "idle" } },
  });
  expect(snapshot?.members[0]).not.toHaveProperty("seenThrough");
  expect(snapshot?.members[0]).not.toHaveProperty("sessionId");
  expect(snapshot?.lead).not.toHaveProperty("metadata");
  expect(snapshot).not.toHaveProperty("sessionStates");
});

test("a reply committed after the durable read cannot advance the snapshot beyond its transcript", async () => {
  const { channel, channels } = await openChannel();
  const request = await channels.appendMessage({
    id: "pending-request",
    channelId: channel.id,
    sender: { type: "agent", agentId: channel.id },
    content: "Which direction?",
    request: true,
  });
  const before = (await channels.getChannel(channel.id))!;
  const transaction = database.inStateTransaction;
  // Commit the reply immediately after the first read transaction, before its caller resumes.
  // Separately reading metadata or the request afterward would produce a torn public snapshot.
  const reads = spyOn(database, "inStateTransaction").mockImplementationOnce(
    async (db, operation) => {
      const result = await transaction(db, operation);
      await channels.appendMessage({
        id: "interleaved-reply",
        channelId: channel.id,
        sender: { type: "user" },
        content: "The eastern path.",
      });
      return result;
    },
  );
  onTestFinished(() => reads.mockRestore());

  const snapshot = (await getChannelSnapshot(channel.id))!;
  expect(snapshot.channel.latestSequence).toBe(before.latestSequence);
  expect(snapshot.messages.at(-1)?.sequence).toBe(snapshot.channel.latestSequence);
  expect(snapshot.channel.requestSequence).toBe(1);
  expect(snapshot.request?.id).toBe(request.message.id);
  expect(snapshot.messages.some(({ id }) => id === "interleaved-reply")).toBe(false);
  expect(await channels.getChannel(channel.id)).toMatchObject({
    latestSequence: before.latestSequence + 1,
    requestSequence: null,
  });
});

test("cached reconnects replay before presence; an expired cursor replaces history", async () => {
  const { channel, channels } = await openChannel();
  const changed = await channels.updateChannel(channel.id, {
    tasks: [{ id: "work", title: "Work added while disconnected", status: "pending" }],
  });
  for (const event of changed.events) publishChannelEvent(channel.id, resolveEventResources(event));
  const reads = spyOn(ChannelDatabase.prototype, "getSnapshot");
  onTestFinished(() => reads.mockRestore());
  const client = observe(channel.id, 0);
  expect(await client.next()).toEqual(resolveEventResources(changed.events[0]!));
  expect(await client.next()).toEqual({
    type: "resumed",
    presence: { [channel.id]: { state: "idle" } },
  });
  client.stop();
  const current = observe(channel.id, changed.events[0]!.revision);
  expect(await current.next()).toMatchObject({ type: "resumed" });
  expect(reads).not.toHaveBeenCalled();
  current.stop();
  releaseChannelEvents(channel.id);
  const expired = observe(channel.id, 0);
  expect(await expired.next()).toMatchObject({
    type: "snapshot",
    state: { channel: changed.channel },
  });
  expect(reads).toHaveBeenCalledTimes(1);
});

test("live events and presence send only changed facts without rereading durable state", async () => {
  const { channel, channels } = await openChannel();
  const client = observe(channel.id, 0);
  expect(await client.next()).toMatchObject({ type: "resumed" });
  const snapshots = spyOn(ChannelDatabase.prototype, "getSnapshot");
  const rosters = spyOn(ChannelDatabase.prototype, "getRoster");
  onTestFinished(() => {
    snapshots.mockRestore();
    rosters.mockRestore();
  });
  const status = await channels.setAgentStatus(channel.id, { state: "waiting", text: "A reply" });
  publishChannelEvent(channel.id, status!.events[0]!);
  expect(await client.next()).toMatchObject({ type: "status" });
  expect(await client.next()).toEqual({
    type: "presence",
    presence: { [channel.id]: { state: "waiting", text: "A reply" } },
  });
  setSessionStatus(channel.id, "running");
  expect(await client.next()).toEqual({
    type: "presence",
    presence: { [channel.id]: { state: "working" } },
  });
  setSessionStatus(channel.id, "idle");
  expect(await client.next()).toEqual({
    type: "presence",
    presence: { [channel.id]: { state: "waiting", text: "A reply" } },
  });
  broadcast({ type: "channel.upserted", channel });
  await Bun.sleep(0);
  expect(client.events).toEqual([]);
  expect(snapshots).not.toHaveBeenCalled();
  expect(rosters).not.toHaveBeenCalled();
  broadcast({ type: "channel.deleted", channelId: "unrelated" });
  expect(client.closed).toBe(false);
  broadcast({ type: "channel.deleted", channelId: channel.id });
  expect(await client.next()).toEqual({ type: "deleted", channelId: channel.id });
  expect(client.closed).toBe(true);
});

test.each([undefined, 0])(
  "a change during connection follows the coherent initial view (cursor %s)",
  async (after) => {
    const { channel, channels } = await openChannel();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const transaction = database.inStateTransaction;
    const held = spyOn(database, "inStateTransaction").mockImplementationOnce(
      async (db, operation) => {
        const result = await transaction(db, operation);
        entered.resolve();
        await release.promise;
        return result;
      },
    );
    onTestFinished(() => {
      release.resolve();
      held.mockRestore();
    });
    const client = observe(channel.id, after);
    await entered.promise;
    const change = await channels.setAgentStatus(channel.id, { state: "waiting", text: "A reply" });
    publishChannelEvent(channel.id, change!.events[0]!);
    release.resolve();
    expect(await client.next()).toMatchObject({
      type: after === undefined ? "snapshot" : "resumed",
    });
    expect(await client.next()).toEqual(change!.events[0]!);
    expect(await client.next()).toMatchObject({
      type: "presence",
      presence: { [channel.id]: { state: "waiting", text: "A reply" } },
    });
  },
);

test("disconnecting during a snapshot suppresses its result and later events", async () => {
  const { channel, channels } = await openChannel();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const original = channels.getSnapshot.bind(channels);
  const reads = spyOn(ChannelDatabase.prototype, "getSnapshot").mockImplementationOnce(
    async (...args) => {
      const state = await original(...args);
      entered.resolve();
      await release.promise;
      finished.resolve();
      return state;
    },
  );
  onTestFinished(() => {
    release.resolve();
    reads.mockRestore();
  });
  const events: ChannelObservationEvent[] = [];
  const stop = streamChannel(
    channel.id,
    (event) => events.push(event),
    () => {},
  );
  onTestFinished(stop);
  await entered.promise;
  stop();
  release.resolve();
  await finished.promise;
  broadcast({ type: "channel.upserted", channel });
  publishChannelEvent(channel.id, { type: "status", revision: 1, agentId: channel.id });
  await Bun.sleep(0);
  expect(events).toEqual([]);
});

test("the HTTP stream snapshots, resumes by cursor, and ends for missing Channels", async () => {
  const { channel } = await openChannel();
  const expected = (await getChannelSnapshot(channel.id))!;
  const abort = new AbortController();
  onTestFinished(() => abort.abort());
  const stream = await getChannelResponse(
    channel.id,
    new Request("http://localhost/channel", {
      signal: abort.signal,
    }),
  );
  expect(stream.headers.get("content-type")).toStartWith("text/event-stream");
  const reader = stream.body!.getReader();
  expect(await nextEvent(reader)).toEqual({ type: "snapshot", state: expected });
  abort.abort();
  expect((await reader.read()).done).toBe(true);
  const resumed = await getChannelResponse(
    channel.id,
    new Request("http://localhost/channel?after=999", {
      headers: { Accept: "text/event-stream", "Last-Event-ID": String(expected.revision) },
    }),
  );
  const resumedReader = resumed.body!.getReader();
  expect(await nextEvent(resumedReader)).toMatchObject({ type: "resumed" });
  await resumedReader.cancel();
  for (const query of ["?after=", "?after=%20%20"]) {
    const blank = await getChannelResponse(
      channel.id,
      new Request(`http://localhost/channel${query}`, {
        headers: { Accept: "text/event-stream" },
      }),
    );
    const reader = blank.body!.getReader();
    expect(await nextEvent(reader)).toEqual({ type: "snapshot", state: expected });
    await reader.cancel();
  }
  for (const cursor of ["", "?after=0"]) {
    const missing = await getChannelResponse(
      "missing",
      new Request(`http://localhost/channel${cursor}`, {
        headers: { Accept: "text/event-stream" },
      }),
    );
    const reader = missing.body!.getReader();
    expect(await nextEvent(reader)).toEqual({ type: "deleted", channelId: "missing" });
    expect((await reader.read()).done).toBe(true);
  }
});

test("snapshot failures terminate observation without exposing private errors", async () => {
  const { channel } = await openChannel();
  const reads = spyOn(ChannelDatabase.prototype, "getSnapshot").mockRejectedValue(
    new Error("Private database details"),
  );
  const errors = spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => {
    reads.mockRestore();
    errors.mockRestore();
  });
  const closed = Promise.withResolvers<void>();
  const events: ChannelObservationEvent[] = [];
  const stop = streamChannel(channel.id, (event) => events.push(event), closed.resolve);
  onTestFinished(stop);
  await closed.promise;
  broadcast({ type: "channel.upserted", channel });
  publishChannelEvent(channel.id, { type: "status", revision: 1, agentId: channel.id });
  await Bun.sleep(0);
  expect(events).toEqual([]);
});

test("HTTP publication returns the canonical user receipt and maps duplicate IDs to conflict", async () => {
  const { channel } = await openChannel();
  const message = { id: "public", content: "Please continue @http-no-recipient" };
  const response = await postChannelMessageResponse(channel.id, post(message));
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    version: 1,
    message: { ...message, sequence: 1, sender: { type: "user" } },
  });
  const history = await getChannelHistoryResponse(
    channel.id,
    new Request("http://localhost/channel/messages?before=2"),
  );
  expect(history.headers.get("cache-control")).toBe("no-store");
  expect(await history.json()).toMatchObject({ revision: 1, messages: [{ id: message.id }] });
  expect(
    (
      await getChannelHistoryResponse(
        "missing",
        new Request("http://localhost/channel/messages?before=2"),
      )
    ).status,
  ).toBe(404);
  const duplicate = await postChannelMessageResponse(channel.id, post(message));
  expect(duplicate.status).toBe(409);
});

test("the HTTP read command returns its cursor for changes and no-ops", async () => {
  const { channel, channels } = await openChannel();
  await channels.appendMessage({
    id: "unread",
    channelId: channel.id,
    sender: { type: "user" },
    content: "Hello",
  });
  const response = await markChannelReadResponse(channel.id, post({ sequence: 1 }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ version: 1, seenThrough: 1 });
  const unchanged = await markChannelReadResponse(channel.id, post({ sequence: 1 }));
  expect(await unchanged.json()).toEqual({ version: 1, seenThrough: 1 });
  expect((await markChannelReadResponse("missing", post({ sequence: 0 }))).status).toBe(404);
});

test("HTTP rejects malformed bodies, channel overrides, unsupported content types and missing Channels", async () => {
  const { channel } = await openChannel();
  for (const body of [null, [], {}, { id: "message", content: "Hello", channelId: "other" }]) {
    expect((await postChannelMessageResponse(channel.id, post(body))).status).toBe(400);
  }
  for (const before of ["", "0", "-1", "1.5", "bad"]) {
    const response = await getChannelHistoryResponse(
      channel.id,
      new Request(`http://localhost/channel/messages?before=${before}`),
    );
    expect(response.status).toBe(400);
  }
  const malformed = await postChannelMessageResponse(
    channel.id,
    new Request("http://localhost/channel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    }),
  );
  expect(malformed.status).toBe(400);
  const unsupported = await postChannelMessageResponse(
    channel.id,
    new Request("http://localhost/channel", { method: "POST", body: "hello" }),
  );
  expect(unsupported.status).toBe(400);
  expect(
    (await postChannelMessageResponse("missing", post({ id: "m", content: "Hi" }))).status,
  ).toBe(404);
});

function post(body: unknown): Request {
  return new Request("http://localhost/channel/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function nextEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ChannelObservationEvent> {
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("Channel stream closed before its next event");
    const data = decoder
      .decode(value)
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (data) return JSON.parse(data.slice(6));
  }
}
