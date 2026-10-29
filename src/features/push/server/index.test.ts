import { expect, mock, onTestFinished, spyOn, test } from "bun:test";
import * as database from "@/server/database";
import { PushDatabase } from "./database";
import { publishBadge, PushService, startPush } from ".";
import type { NotificationEvent, UpdateEvent } from "@push/model";
import { RelaySender, type APNsMessage, type APNsResult } from "./apns";

const id = "00000000-0000-4000-8000-000000000001";
const registration = { registrationID: id, token: "aabb", environment: "sandbox" } as const;
const badgeTopics = ["requests", "completions"];
const notification: NotificationEvent = {
  type: "notification",
  key: `${id}:request`,
  title: "Test",
  body: "Test",
  category: "request",
  data: {},
};
const update = (value: number, attention?: number, ending = false): UpdateEvent => ({
  type: "update",
  value: { value },
  attention,
  ending,
  render: (at) => ({ value, updatedAt: at }),
});
async function setup(sending?: (message: APNsMessage) => Promise<APNsResult>) {
  const db = await database.createTestDatabase(),
    store = new PushDatabase(db);
  const sent: APNsMessage[] = [],
    interests: [string, boolean][] = [];
  const errors = spyOn(console, "error").mockImplementation(() => {});
  let now = 100000,
    result: APNsResult = { status: 200 };
  const service = new PushService(
    db,
    {
      send: async (message) => {
        sent.push(message);
        return sending ? sending(message) : result;
      },
    },
    (topic, active) => interests.push([topic, active]),
    () => now,
  );
  onTestFinished(async () => {
    service.stop();
    errors.mockRestore();
    await db.close();
  });
  await store.register(registration);
  return {
    store,
    service,
    sent,
    interests,
    now: () => now,
    advance: (seconds: number) => {
      now += seconds;
    },
    result: (value: APNsResult) => {
      result = value;
    },
    follow: async (token = "1122") => {
      await store.subscribe({ registrationID: id, token, startedAt: now }, "topic");
      await service.load("topic");
    },
    flushUpdate: async (event: UpdateEvent) => {
      await service.publish("topic", event);
      await service.flush();
    },
  };
}

test("a badge source registered before Push starts survives startup and a consumer restart", async () => {
  const db = await database.createTestDatabase();
  const store = new PushDatabase(db);
  await store.register(registration);
  await store.subscribe({ registrationID: id, token: null, startedAt: null }, "requests");
  const access = spyOn(database, "getStateDatabase").mockResolvedValue(db);
  const sending = spyOn(RelaySender.prototype, "send").mockResolvedValue({ status: 200 });
  let stop = () => {};
  onTestFinished(async () => {
    stop();
    await publishBadge([], async () => undefined);
    sending.mockRestore();
    access.mockRestore();
    await db.close();
  });
  const count = mock(async () => 2);
  expect(publishBadge(badgeTopics, count)).toBeUndefined();
  expect(count).not.toHaveBeenCalled();
  stop = await startPush();
  expect(sending.mock.calls[0]?.[0].payload).toEqual({ aps: { badge: 2 } });
  expect(count).toHaveBeenCalledTimes(1);
  stop();
  stop = await startPush();
  expect(sending).toHaveBeenCalledTimes(2);
  expect(sending.mock.calls[1]?.[0].payload).toEqual({ aps: { badge: 2 } });
});

test("alerts are lazy, route only to notification subscribers and make one attempt", async () => {
  const f = await setup(),
    factory = mock(async () => notification);
  await f.service.load();
  expect(f.service.publish("none", factory)).toBeUndefined();
  expect(factory).not.toHaveBeenCalled();
  await f.store.subscribe({ registrationID: id, token: null, startedAt: null }, "topic");
  await f.service.load();
  f.result({ status: 503 });
  await f.service.publish("topic", factory);
  expect(factory).toHaveBeenCalledTimes(1);
  expect(f.sent[0]).toMatchObject({
    pushType: "alert",
    expiration: f.now() + 900,
    collapseID: notification.key,
  });
  await f.flushUpdate(update(1));
  await f.service.tick();
  expect(f.sent).toHaveLength(1);
  await f.store.unregister(id);
  await f.service.load();
  expect(f.interests).toEqual([
    ["topic", true],
    ["topic", false],
  ]);
});

test("badge-only pushes deduplicate installs, include zero and stop when both alert topics are off", async () => {
  const f = await setup();
  let count = 2;
  const current = mock(async () => count);
  await f.service.load();
  await f.service.publishBadge(badgeTopics, current);
  expect(current).not.toHaveBeenCalled();
  await f.store.subscribe({ registrationID: id, token: null, startedAt: null }, "unrelated");
  await f.service.load();
  await f.follow();
  await f.service.publishBadge(badgeTopics, current);
  expect(f.sent).toEqual([]);
  for (const topic of ["requests", "completions"])
    await f.store.subscribe({ registrationID: id, token: null, startedAt: null }, topic);
  await f.service.load();
  expect(f.sent).toHaveLength(1);
  expect(f.sent[0]).toMatchObject({
    token: registration.token,
    pushType: "alert",
    priority: 10,
    collapseID: "badge",
    payload: { aps: { badge: 2 } },
  });
  expect(f.sent[0]!.payload).toEqual({ aps: { badge: 2 } });
  await f.service.publishBadge(badgeTopics, current);
  expect(f.sent).toHaveLength(1);
  count = 0;
  await f.service.publishBadge(badgeTopics, current);
  expect(f.sent.at(-1)?.payload).toEqual({ aps: { badge: 0 } });
  await f.service.publish("requests", notification);
  expect(f.sent.at(-1)?.payload).toMatchObject({ aps: { alert: { title: "Test" } } });
  expect(f.sent.at(-1)?.payload).not.toHaveProperty("aps.badge");
  for (const topic of ["requests", "completions"]) await f.store.unsubscribe(id, topic);
  await f.service.load();
  const attempts = f.sent.length;
  current.mockClear();
  count = 3;
  await f.service.publishBadge(badgeTopics, current);
  await f.service.tick();
  expect(current).not.toHaveBeenCalled();
  expect(f.sent).toHaveLength(attempts);
  await f.store.subscribe({ registrationID: id, token: null, startedAt: null }, "completions");
  await f.service.load();
  expect(f.sent.at(-1)?.payload).toEqual({ aps: { badge: 3 } });
  expect(f.sent).toHaveLength(attempts + 1);
});

test("opt-out during a held count prevents sending a badge through stale subscriptions", async () => {
  const f = await setup();
  await f.store.subscribe({ registrationID: id, token: null, startedAt: null }, "requests");
  await f.service.load();
  const entered = Promise.withResolvers<void>(),
    value = Promise.withResolvers<number>();
  const work = f.service.publishBadge(badgeTopics, async () => {
    entered.resolve();
    return value.promise;
  });
  await entered.promise;
  await f.store.unsubscribe(id, "requests");
  value.resolve(3);
  await work;
  expect(f.sent).toEqual([]);
});

test("an alert delivered after a newer badge-only push cannot restore an older count", async () => {
  const f = await setup();
  await f.store.subscribe({ registrationID: id, token: null, startedAt: null }, "requests");
  await f.service.load();
  let count = 2;
  const current = mock(async () => count);
  await f.service.publishBadge(badgeTopics, current);
  await f.service.publish("requests", notification);
  const alert = f.sent.at(-1)!;
  count = 1;
  await f.service.publishBadge(badgeTopics, current);
  const latest = f.sent.at(-1)!;
  let icon = 2;
  for (const message of [latest, alert]) {
    const aps = (message.payload as { aps: { badge?: number } }).aps;
    if (aps.badge !== undefined) icon = aps.badge;
  }
  expect(icon).toBe(1);
  expect(current).toHaveBeenCalledTimes(2);
  expect(alert.payload).not.toHaveProperty("aps.badge");

  const value = Promise.withResolvers<NotificationEvent>();
  const delayed = f.service.publish("requests", () => value.promise);
  await f.store.unsubscribe(id, "requests");
  const attempts = f.sent.length;
  value.resolve(notification);
  await delayed;
  expect(f.sent).toHaveLength(attempts);
});

test("a successful alert cannot acknowledge a failed badge-only push", async () => {
  const f = await setup();
  await f.store.subscribe({ registrationID: id, token: null, startedAt: null }, "requests");
  await f.service.load();
  f.result({ status: 503 });
  await f.service.publishBadge(badgeTopics, async () => 2);
  f.result({ status: 200 });
  await f.service.publish("requests", notification);
  await f.service.tick();
  expect(f.sent).toHaveLength(3);
  expect(f.sent.at(-1)?.payload).toEqual({ aps: { badge: 2 } });
});

test("stopping during a badge send does not deliver the next install", async () => {
  const entered = Promise.withResolvers<void>(),
    response = Promise.withResolvers<APNsResult>();
  const f = await setup(async () => {
    entered.resolve();
    return response.promise;
  });
  onTestFinished(() => response.resolve({ status: 200 }));
  const otherID = "00000000-0000-4000-8000-000000000002";
  await f.store.register({ ...registration, registrationID: otherID, token: "bbcc" });
  for (const registrationID of [id, otherID])
    await f.store.subscribe({ registrationID, token: null, startedAt: null }, "requests");
  await f.service.load();
  const work = f.service.publishBadge(badgeTopics, async () => 2);
  await entered.promise;
  f.service.stop();
  response.resolve({ status: 200 });
  await work;
  expect(f.sent).toHaveLength(1);
});

test("serialized badge writes finish with the fresh count and catch up a rotated token", async () => {
  const entered = Promise.withResolvers<void>(),
    response = Promise.withResolvers<APNsResult>();
  let first = true;
  const f = await setup(async () => {
    if (first) {
      first = false;
      entered.resolve();
      return response.promise;
    }
    return { status: 200 };
  });
  onTestFinished(() => response.resolve({ status: 200 }));
  await f.store.subscribe({ registrationID: id, token: null, startedAt: null }, "requests");
  await f.service.load();
  let count = 2;
  const initial = f.service.publishBadge(badgeTopics, async () => count);
  await entered.promise;
  count = 0;
  const latest = f.service.publishBadge(badgeTopics, async () => count);
  response.resolve({ status: 200 });
  await Promise.all([initial, latest]);
  expect(f.sent.map(({ payload }) => payload)).toEqual([
    { aps: { badge: 2 } },
    { aps: { badge: 0 } },
  ]);
  await f.store.register({ ...registration, token: "ccdd" });
  await f.service.load();
  expect(f.sent.at(-1)).toMatchObject({ token: "ccdd", payload: { aps: { badge: 0 } } });
  f.service.stop();
  count = 9;
  expect(f.service.publishBadge(badgeTopics, async () => count)).toBeUndefined();
});

test.each([403, 429, 503])(
  "APNs %i does not acknowledge a badge and the tick catches up the latest count",
  async (status) => {
    const f = await setup();
    await f.store.subscribe({ registrationID: id, token: null, startedAt: null }, "requests");
    await f.service.load();
    let count = 2;
    f.result({ status });
    await f.service.publishBadge(badgeTopics, async () => count);
    expect(f.sent).toHaveLength(1);
    expect(await f.store.subscriptions()).toHaveLength(1);
    f.result({ status: 200 });
    count = 0;
    await f.service.tick();
    expect(f.sent.at(-1)?.payload).toEqual({ aps: { badge: 0 } });
    await f.service.tick();
    expect(f.sent).toHaveLength(2);
  },
);

test.each([
  { status: 410, reason: "Unregistered" },
  { status: 400, reason: "BadDeviceToken" },
])(
  "badge rejection $status $reason prunes the dead token and still reaches another install",
  async (rejection) => {
    const f = await setup(async (message) =>
      message.token === registration.token ? rejection : { status: 200 },
    );
    const otherID = "00000000-0000-4000-8000-000000000002";
    await f.store.register({ ...registration, registrationID: otherID, token: "bbcc" });
    for (const registrationID of [id, otherID])
      for (const topic of ["requests", "completions"])
        await f.store.subscribe({ registrationID, token: null, startedAt: null }, topic);
    await f.service.load();
    await f.service.publishBadge(badgeTopics, async () => 2);
    expect(f.sent.map(({ token }) => token)).toEqual(["aabb", "bbcc"]);
    expect((await f.store.subscriptions()).map(({ registrationID }) => registrationID)).toEqual([
      otherID,
      otherID,
    ]);
    await f.service.tick();
    expect(f.sent).toHaveLength(2);
  },
);

for (const ending of [false, true])
  test(`queued delivery coalesces latest state and preserves a replacement token (ending=${ending})`, async () => {
    const entered = Promise.withResolvers<void>(),
      response = Promise.withResolvers<APNsResult>();
    let calls = 0;
    const f = await setup(async () => {
      if (calls++ === 0) {
        entered.resolve();
        return response.promise;
      }
      return { status: 200 };
    });
    onTestFinished(() => response.resolve({ status: 200 }));
    await f.follow();
    await f.service.publish("topic", update(1, undefined, ending));
    const first = f.service.flush();
    await entered.promise;
    await f.store.subscribe({ registrationID: id, token: "ccdd", startedAt: f.now() }, "topic");
    await f.service.publish("topic", update(2));
    await f.service.publish("topic", update(3));
    const queued = [f.service.load("topic"), f.service.flush(), f.service.tick()];
    expect(f.sent).toHaveLength(1);
    response.resolve({ status: 200 });
    await Promise.all([first, ...queued]);
    expect(f.sent).toHaveLength(2);
    expect(f.sent[1]).toMatchObject({
      token: "ccdd",
      payload: { aps: { event: "update", "content-state": { value: 3 } } },
    });
    expect((await f.store.subscriptions())[0]?.token).toBe("ccdd");
    await f.flushUpdate(update(3));
    expect(f.sent).toHaveLength(2);
  });

test("unchanged events do not postpone the fixed tick's ten-minute refresh bound", async () => {
  const f = await setup();
  await f.follow();
  f.advance(0.125);
  await f.flushUpdate(update(1));
  const deliveredAt = f.now();
  f.advance(299.75);
  await f.flushUpdate(update(1));
  f.advance(0.125);
  await f.service.tick();
  expect(f.sent).toHaveLength(1);
  f.advance(300);
  await f.service.tick();
  expect(f.sent).toHaveLength(2);
  expect(f.now() - deliveredAt).toBeLessThanOrEqual(600);
});

test.each([403, 429, 503])(
  "APNs %i retains updates and ends until a successful tick",
  async (status) => {
    const f = await setup();
    await f.follow();
    for (const ending of [false, true]) {
      f.result({ status });
      await f.flushUpdate(update(1, 15, ending));
      expect(await f.store.subscriptions()).toHaveLength(1);
      f.result({ status: 200 });
      f.advance(300);
      await f.service.tick();
      expect(await f.store.subscriptions()).toHaveLength(ending ? 0 : 1);
      expect(f.sent.at(-1)?.priority).toBe(10);
    }
  },
);

test("request urgency survives coalescing but is not repeated for later content", async () => {
  const f = await setup();
  await f.follow();
  await f.flushUpdate(update(0));
  await f.service.publish("topic", update(1, 15));
  await f.flushUpdate(update(2, 15));
  await f.flushUpdate(update(3, 15));
  expect(f.sent.map(({ priority }) => priority)).toEqual([5, 10, 5]);
});

test("delivery failures do not reload subscriptions and successful endings reload once", async () => {
  const f = await setup();
  await f.follow();
  const otherID = "00000000-0000-4000-8000-000000000002";
  await f.store.register({ ...registration, registrationID: otherID, token: "bbcc" });
  await f.store.subscribe({ registrationID: otherID, token: "ccdd", startedAt: f.now() }, "topic");
  await f.service.load("topic");
  const reads = spyOn(PushDatabase.prototype, "subscriptions");
  onTestFinished(() => reads.mockRestore());
  f.result({ status: 503 });
  await f.flushUpdate(update(1));
  expect(reads).not.toHaveBeenCalled();
  f.result({ status: 200 });
  await f.flushUpdate(update(1, undefined, true));
  expect(f.sent).toHaveLength(4);
  expect(reads).toHaveBeenCalledTimes(1);
  expect(await f.store.subscriptions()).toEqual([]);
  expect(f.interests.at(-1)).toEqual(["topic", false]);
});

test("a throttled install cannot repeatedly spend a healthy Activity's request budget", async () => {
  const f = await setup(async (message) => ({ status: message.token === "ccdd" ? 429 : 200 }));
  await f.follow();
  const other = {
    ...registration,
    registrationID: "00000000-0000-4000-8000-000000000002",
    token: "bbcc",
  };
  await f.store.register(other);
  await f.store.subscribe(
    { registrationID: other.registrationID, token: "ccdd", startedAt: f.now() },
    "topic",
  );
  await f.service.load("topic");
  for (let index = 0; index < 6; index++) await f.flushUpdate(update(1, 15));
  expect(f.sent).toHaveLength(2);
  await f.flushUpdate(update(2, 15));
  expect(f.sent.slice(-2).map(({ priority }) => priority)).toEqual([5, 5]);
});

test("token subscriptions catch up unchanged content and expire on reload without a made-up end", async () => {
  const f = await setup();
  await f.follow();
  await f.flushUpdate(update(1, 15));
  await f.follow("ccdd");
  await f.service.flush();
  expect(f.sent).toHaveLength(2);
  expect(f.sent[1]).toMatchObject({ token: "ccdd", priority: 10 });
  f.advance(8 * 3600);
  await f.service.tick();
  expect(await f.store.subscriptions()).toEqual([]);
  expect(f.sent).toHaveLength(2);
  expect(f.interests.at(-1)).toEqual(["topic", false]);
});

test.each([
  [410, "Unregistered"],
  [410, "ExpiredToken"],
  [400, "BadDeviceToken"],
] as const)("APNs %i %s prunes only the dead activity address", async (status, reason) => {
  const f = await setup();
  await f.follow();
  await f.store.subscribe({ registrationID: id, token: null, startedAt: null }, "requests");
  await f.service.load();
  f.result({ status, reason });
  await f.flushUpdate(update(1));
  expect((await f.store.subscriptions()).map(({ topic }) => topic)).toEqual(["requests"]);
});
