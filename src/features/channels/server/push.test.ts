import { expect, onTestFinished, spyOn, test } from "bun:test";
import * as push from "@push/server";
import * as database from "@/server/database";
import * as stream from "./stream";
import * as reducer from "@channels/model/reducer";
import { PushDatabase } from "@push/server/database";
import type { APNsMessage } from "@push/server/apns";
import { ChannelDatabase } from "./database";
import { createStoredChannel } from "./testFixtures";
import { publishChannelNotification, startChannelPush } from "./push";
import { broadcast } from "@workspace/server/events";
import type { ChannelObservationEvent } from "@channels/model";

test("the unread check builds current channel text and the lead's Reply handle on the server", async () => {
  const db = await database.createTestDatabase();
  onTestFinished(() => db.close());
  const channels = new ChannelDatabase(db);
  const channel = await createStoredChannel(channels, {
    name: "Original",
    model: { provider: "copilot", name: "test" },
  });
  const change = await channels.appendMessage({
    channelId: channel.id,
    id: crypto.randomUUID(),
    sender: { type: "agent", agentId: channel.id },
    request: true,
    content: "@lead Which **door**?",
  });
  const access = spyOn(database, "getStateDatabase").mockResolvedValue(db);
  const publishing = spyOn(push, "publish").mockImplementation(() => undefined);
  const sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined);
  onTestFinished(() => {
    access.mockRestore();
    publishing.mockRestore();
    sleep.mockRestore();
  });
  const snapshot = await stream.getChannelSnapshot(channel.id);
  const message = snapshot?.messages.find(
    (message) => message.sequence === change.message.sequence,
  );
  if (!message) throw new Error("Missing committed request.");
  publishChannelNotification(change.channel, message);
  expect(publishing.mock.calls[0]?.[0]).toBe("requests");
  const factory = publishing.mock.calls[0]?.[1];
  if (typeof factory !== "function") throw new Error("Missing lazy request publication.");
  await channels.editChannel({ channelId: channel.id, name: "Renamed" });
  expect(await factory()).toMatchObject({
    title: "Renamed",
    body: "Which door?",
    threadID: channel.id,
    data: { handle: "lead", channelID: channel.id, sequence: change.message.sequence },
  });
  expect(sleep).toHaveBeenCalledWith(3000);
  await channels.markUserSeen(channel.id, change.message.sequence);
  expect(await factory()).toBeUndefined();
  expect((await channels.getChannel(channel.id))?.requestSequence).toBe(change.message.sequence);
});

test("workspace changes update badges from the catalog, and replacing or stopping the observer removes it", async () => {
  const db = await database.createTestDatabase();
  onTestFinished(() => db.close());
  const channels = new ChannelDatabase(db);
  const changes = [];
  for (const name of ["First", "Second"]) {
    const channel = await createStoredChannel(channels, {
      name,
      model: { provider: "copilot", name: "test" },
    });
    changes.push(
      await channels.appendMessage({
        channelId: channel.id,
        id: crypto.randomUUID(),
        sender: { type: "agent", agentId: channel.id },
        request: true,
        content: "Which door?",
      }),
    );
  }
  const [first, second] = changes;
  if (!first || !second) throw new Error("Missing request fixtures.");
  const registrationID = "00000000-0000-4000-8000-000000000001";
  const store = new PushDatabase(db);
  await store.register({ registrationID, token: "aabb", environment: "sandbox" });
  for (const topic of ["requests", "completions"])
    await store.subscribe({ registrationID, token: null, startedAt: null }, topic);
  const sent: APNsMessage[] = [];
  const service = new push.PushService(db, {
    send: async (message) => {
      sent.push(message);
      return { status: 200 };
    },
  });
  const access = spyOn(database, "getStateDatabase").mockResolvedValue(db);
  const publishing = spyOn(push, "publishBadge").mockImplementation((topics, count) =>
    service.publishBadge(topics, count),
  );
  let stop = () => {};
  onTestFinished(() => {
    stop();
    service.stop();
    publishing.mockRestore();
    access.mockRestore();
  });
  await service.load();
  stop = startChannelPush();
  await service.load();
  expect(sent.map(({ payload }) => payload)).toEqual([{ aps: { badge: 2 } }]);
  const read = await channels.markUserSeen(first.channel.id, first.message.sequence);
  if (!read) throw new Error("Missing read transition.");
  broadcast({ type: "channel.upserted", channel: read.channel });
  await service.load();
  expect(sent).toHaveLength(1);
  const replied = await channels.appendMessage({
    channelId: first.channel.id,
    id: crypto.randomUUID(),
    sender: { type: "user" },
    content: "The blue door.",
  });
  broadcast({ type: "channel.upserted", channel: replied.channel });
  await service.load();
  expect(sent.at(-1)?.payload).toEqual({ aps: { badge: 1 } });
  await channels.deleteChannel(second.channel.id);
  broadcast({ type: "channel.deleted", channelId: second.channel.id });
  await service.load();
  expect(sent.at(-1)?.payload).toEqual({ aps: { badge: 0 } });
  stop = startChannelPush();
  await service.load();
  publishing.mockClear();
  broadcast({ type: "channel.upserted", channel: replied.channel });
  await service.load();
  expect(publishing).toHaveBeenCalledTimes(1);
  stop();
  publishing.mockClear();
  broadcast({ type: "channel.deleted", channelId: first.channel.id });
  await service.load();
  expect(publishing).not.toHaveBeenCalled();
});

test("Follow observes only interested channels and promptly dismisses deleted content", async () => {
  const db = await database.createTestDatabase();
  onTestFinished(() => db.close());
  const channels = new ChannelDatabase(db);
  const channel = await createStoredChannel(channels, {
    name: "Test",
    model: { provider: "copilot", name: "test" },
  });
  const access = spyOn(database, "getStateDatabase").mockResolvedValue(db);
  const snapshot = await stream.getChannelSnapshot(channel.id);
  if (!snapshot) throw new Error("Missing fixture channel.");
  const followed = {
    ...snapshot,
    channel: {
      ...snapshot.channel,
      requestSequence: 15,
      tasks: [{ id: "one", title: "Work", status: "in_progress" as const }],
    },
  };
  access.mockClear();
  let interest: (topic: string, active: boolean) => void = () => {};
  let emit: (event: ChannelObservationEvent) => void = () => {};
  let closeStream: VoidFunction = () => {};
  let closed = 0;
  const observing = spyOn(push, "observeTopics").mockImplementation((listener) => {
    interest = listener;
    return () => {};
  });
  const opening = spyOn(stream, "streamChannel").mockImplementation((_, send, close) => {
    emit = send;
    closeStream = close;
    return () => {
      closed++;
    };
  });
  const publishing = spyOn(push, "publish").mockImplementation(() => Promise.resolve());
  const reducing = spyOn(reducer, "reduceChannelState");
  const stop = startChannelPush();
  onTestFinished(() => {
    stop();
    observing.mockRestore();
    opening.mockRestore();
    publishing.mockRestore();
    reducing.mockRestore();
    access.mockRestore();
  });
  expect(access).not.toHaveBeenCalled();
  expect(opening).not.toHaveBeenCalled();
  interest("requests", true);
  expect(opening).not.toHaveBeenCalled();
  interest(`channel:${channel.id}`, true);
  emit({ type: "snapshot", state: followed });
  emit({ type: "presence", presence: { [channel.id]: { state: "working" } } });
  expect(reducing.mock.calls[1]?.[0].messages).toEqual([]);
  const event = publishing.mock.calls.at(-1)?.[1];
  if (!event || typeof event === "function" || event.type !== "update")
    throw new Error("Missing state publication.");
  expect(event.value).toMatchObject({ workingAgents: [{ id: channel.id }], tasksTotal: 1 });
  expect(Object.keys(event.value)).not.toContain("messages");
  expect(event.value).not.toHaveProperty("updatedAt");
  expect(publishing.mock.calls).toHaveLength(2);
  for (const [, publication] of publishing.mock.calls) {
    if (!publication || typeof publication === "function" || publication.type !== "update")
      throw new Error("Missing request attention publication.");
    expect(publication.attention).toBe(15);
  }

  const timestamp = 1793086200;
  const registrationID = "00000000-0000-4000-8000-000000000001";
  const store = new PushDatabase(db);
  await store.register({ registrationID, token: "aabb", environment: "sandbox" });
  await store.subscribe(
    { registrationID, token: "ccdd", startedAt: timestamp },
    `channel:${channel.id}`,
  );
  const sent: APNsMessage[] = [];
  const service = new push.PushService(
    db,
    {
      send: async (message) => {
        sent.push(message);
        return { status: 200 };
      },
    },
    () => {},
    () => timestamp,
  );
  onTestFinished(() => service.stop());
  await service.load();
  publishing.mockImplementation((topic, publication) => service.publish(topic, publication));
  const timers = spyOn(globalThis, "setTimeout");
  onTestFinished(() => timers.mockRestore());
  emit({ type: "deleted", channelId: channel.id });
  closeStream();
  const flush = timers.mock.calls.find(([, delay]) => delay === 100)?.[0];
  if (typeof flush !== "function")
    throw new Error("Channel deletion did not schedule prompt delivery.");
  await flush();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    priority: 10,
    payload: {
      aps: {
        timestamp,
        event: "end",
        "dismissal-date": timestamp,
        "content-state": { ending: "channelDeleted" },
      },
    },
  });
  expect(await store.subscriptions()).toEqual([]);

  interest(`channel:${channel.id}`, false);
  expect(closed).toBe(1);
});
