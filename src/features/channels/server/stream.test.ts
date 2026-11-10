import { expect, onTestFinished, spyOn, test } from "bun:test";
import { homedir } from "node:os";
import type { ChannelMessage, ChannelObservationEvent } from "@channels/model";
import { broadcast } from "@workspace/server/events";
import { deleteSessionActivity, setSessionActivity } from "@sessions/server/state/activity";
import * as database from "@/server/database";
import { ChannelDatabase, catalogEntry, type ChannelChange } from "./database";
import { publishChannelEvent, releaseChannelEvents } from "./events";
import { publishChannelChange } from "./index";
import {
  getChannelCatalog,
  getChannelSnapshot,
  streamChannel,
  streamChannelCatalog,
  type ChannelCatalogEvent,
} from "./stream";
import { channelAgent, openChannel } from "./testFixtures";

/** Collects streamed events so a test can await each one in order. */
function eventQueue<T>() {
  const events: T[] = [];
  const waiters: Array<(event: T) => void> = [];
  return {
    events,
    send: (event: T) => {
      const waiter = waiters.shift();
      if (waiter) waiter(event);
      else events.push(event);
    },
    next: (): Promise<T> => {
      const event = events.shift();
      return event ? Promise.resolve(event) : new Promise((resolve) => waiters.push(resolve));
    },
  };
}

function observe(channelId: string, afterRevision?: number) {
  const queue = eventQueue<ChannelObservationEvent>();
  let closed = false;
  const stop = streamChannel(channelId, queue.send, () => (closed = true), afterRevision);
  onTestFinished(stop);
  return {
    ...queue,
    stop,
    get closed() {
      return closed;
    },
  };
}

async function observeCatalog() {
  const queue = eventQueue<ChannelCatalogEvent>();
  onTestFinished(await streamChannelCatalog(queue.send));
  return queue;
}

test("snapshots combine public Channel facts with live presence without exposing private worker metadata", async () => {
  const { channel, channels } = await openChannel();
  const worker = channelAgent(channel.id, "reviewer", "Reviewer");
  worker.metadata = { seenThrough: 72 };
  const { member } = await channels.createMember(worker);
  onTestFinished(() => deleteSessionActivity(member.id));
  setSessionActivity(channel.id, "running");

  const file = { kind: "session" as const, sessionId: channel.id, path: "docs/Project plan.md" };
  await channels.shareArtifact({
    channelId: channel.id,
    file,
    title: "Plan",
    actor: { type: "user" },
  });
  const attachments = ["a #1.png", "flow.mov"];
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
  const folder = `/api/serve/machine${homedir()}/.toy-box/channels/${channel.id}/attachments/images`;
  expect(snapshot?.request).toMatchObject({
    attachments: [
      { name: "a #1.png", url: `${folder}/a%20%231.png`, mimeType: "image/png" },
      { name: "flow.mov", url: `${folder}/flow.mov`, mimeType: "video/quicktime" },
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
  expect(snapshot).not.toHaveProperty("activities");
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
  for (const event of changed.events) publishChannelEvent(channel.id, event);
  const reads = spyOn(ChannelDatabase.prototype, "getSnapshot");
  onTestFinished(() => reads.mockRestore());
  const client = observe(channel.id, 0);
  expect(await client.next()).toEqual(changed.events[0]!);
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
  // The snapshot carries the revision and request at its top level, so its Channel is the bare metadata.
  const { revision: _revision, request: _request, ...metadata } = changed.channel!;
  const expired = observe(channel.id, 0);
  expect(await expired.next()).toMatchObject({
    type: "snapshot",
    state: { channel: metadata },
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
  setSessionActivity(channel.id, "running");
  expect(await client.next()).toEqual({
    type: "presence",
    presence: { [channel.id]: { state: "working" } },
  });
  setSessionActivity(channel.id, "background");
  expect(await client.next()).toEqual({
    type: "presence",
    presence: { [channel.id]: { state: "waiting", text: "A reply" } },
  });
  setSessionActivity(channel.id, "running");
  expect(await client.next()).toEqual({
    type: "presence",
    presence: { [channel.id]: { state: "working" } },
  });
  setSessionActivity(channel.id, "idle");
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

test("streams opened during concurrent commits continue their initial view in revision order", async () => {
  const { channel, channels } = await openChannel();
  const changes: Array<(step: string) => Promise<ChannelChange | null>> = [
    (step: string) =>
      channels.appendMessage({
        id: step,
        channelId: channel.id,
        sender: { type: "user" },
        content: step,
      }),
    (step: string) => channels.setAgentStatus(channel.id, { state: "working", text: step }),
    (step: string) =>
      channels.updateChannel(channel.id, {
        tasks: [{ id: "work", title: step, status: "pending" }],
      }),
  ];
  const opening = Promise.withResolvers<void>();
  let published = 0;
  const upserted: number[] = [];
  const writers = changes.map(async (change, writer) => {
    for (let step = 0; step < 8; step++) {
      const committed = (await change(`${writer}-${step}`))!;
      publishChannelChange(committed);
      if (committed.channel) upserted.push(committed.channel.revision);
      if (++published === 4) opening.resolve();
    }
  });
  await opening.promise;
  const fresh = observe(channel.id);
  const resumed = observe(channel.id, 0);
  const catalog = await observeCatalog();
  await Promise.all(writers);
  const revision = (await getChannelSnapshot(channel.id))!.revision;

  // Each stream starts from its read, then sees every later commit once, in order.
  const opened = fresh.events[0];
  if (opened?.type !== "snapshot") throw new Error("Expected a snapshot");
  for (const [client, start] of [
    [fresh, opened.state.revision],
    [resumed, 0],
  ] as const) {
    expect(client.closed).toBe(false);
    const revisions = client.events.flatMap((event) =>
      "revision" in event ? [event.revision] : [],
    );
    expect([start, ...revisions]).toEqual(
      Array.from({ length: revision - start + 1 }, (_, index) => start + index),
    );
  }
  // Both bootstrap paths read mid-burst.
  expect(opened.state.revision).toBeLessThan(revision);
  expect(resumed.events).toContainEqual(expect.objectContaining({ type: "resumed" }));
  const [listed, ...updates] = catalog.events;
  if (listed?.type !== "snapshot") throw new Error("Expected a snapshot");
  const from = listed.catalog.channels[0]!.revision;
  expect(from).toBeLessThan(upserted.at(-1)!);
  expect(
    updates.flatMap((event) => (event.type === "channel.upserted" ? [event.channel.revision] : [])),
  ).toEqual(upserted.filter((revision) => revision > from));
});

test("a live revision gap closes the stream instead of forwarding an incomplete transcript", async () => {
  const { channel } = await openChannel();
  const client = observe(channel.id);
  const opened = await client.next();
  if (opened.type !== "snapshot") throw new Error("Expected a snapshot");
  publishChannelEvent(channel.id, {
    type: "status",
    revision: opened.state.revision + 2,
    agentId: channel.id,
  });
  expect(client.closed).toBe(true);
  expect(client.events).toEqual([]);
});

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

test("a missing Channel ends observation as deleted, with or without a cursor", async () => {
  await openChannel();
  for (const after of [undefined, 0]) {
    const client = observe("missing", after);
    expect(await client.next()).toEqual({ type: "deleted", channelId: "missing" });
    expect(client.closed).toBe(true);
  }
});

test("the catalog names working agents the way Channel presence does, without tasks", async () => {
  const { channel, channels } = await openChannel();
  await channels.updateChannel(channel.id, {
    tasks: [{ id: "ship", title: "Ship", status: "pending" }],
  });
  await channels.createMember(channelAgent(channel.id, "idle", "Idle"));
  const { member: busy } = await channels.createMember(channelAgent(channel.id, "busy", "Busy"));
  onTestFinished(() => deleteSessionActivity(busy.id));
  setSessionActivity(channel.id, "running");
  setSessionActivity(busy.id, "running");

  const catalog = await getChannelCatalog();
  expect(catalog.working.sort()).toEqual([busy.id, channel.id].sort());
  expect(catalog.channels[0]).not.toHaveProperty("tasks");
});

test("the catalog stream opens with the catalog, then forwards Channel changes and follows who is working", async () => {
  const { channel, channels } = await openChannel();
  const catalog = await observeCatalog();
  expect(await catalog.next()).toEqual({ type: "snapshot", catalog: await getChannelCatalog() });

  const { member } = await channels.createMember(channelAgent(channel.id, "joiner", "Joiner"));
  onTestFinished(() => deleteSessionActivity(member.id));
  broadcast({ type: "channel.member.upserted", member });
  expect(await catalog.next()).toEqual({ type: "channel.member.upserted", member });
  setSessionActivity(member.id, "running");
  expect(await catalog.next()).toEqual({ type: "working", working: [member.id] });

  const renamed = { ...catalogEntry((await channels.getChannel(channel.id))!), name: "Renamed" };
  broadcast({ type: "channel.upserted", channel: renamed });
  expect(await catalog.next()).toEqual({ type: "channel.upserted", channel: renamed });

  const left = {
    type: "channel.member.deleted",
    channelId: channel.id,
    agentId: member.id,
  } as const;
  broadcast(left);
  expect(await catalog.next()).toEqual(left);
  expect(await catalog.next()).toEqual({ type: "working", working: [] });

  setSessionActivity(channel.id, "running");
  expect(await catalog.next()).toEqual({ type: "working", working: [channel.id] });
  broadcast({ type: "channel.deleted", channelId: channel.id });
  expect(await catalog.next()).toEqual({ type: "channel.deleted", channelId: channel.id });
  expect(await catalog.next()).toEqual({ type: "working", working: [] });
});
