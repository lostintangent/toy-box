import { expect, onTestFinished, spyOn, test } from "bun:test";
import {
  experimental_streamedQuery as streamedQuery,
  MutationObserver,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import type { SessionEvent, SessionState } from "./model";
import type { SessionActivity, SessionsActivity } from "./model/activity";
import { applySessionEvent, createInitialSessionState } from "./model/reducer";
import { adoptSessionSnapshot, sessionQueries } from "./queries";
import { streamSession, type SessionObservation } from "./stream";

const snapshot = (lastSeenEventId: number, content: string): SessionState =>
  createInitialSessionState({ lastSeenEventId, messages: [{ role: "user", content }] });

test("opens with a snapshot, follows each announced run from its cursor, and heals once it ends", async () => {
  const session = observeSession();
  session.watch();
  (await session.snapshots.next()).resolve(snapshot(4, "Hello"));
  await session.waitFor((state) => state?.lastSeenEventId === 4);

  session.setActivity({ status: "running", since: 1 });
  const run = await session.connections.next();
  expect(run.url).toBe("/api/sessions/session?after=4");
  expect(session.view()?.status).toBe("thinking");
  run.send({ type: "assistant_message", content: "Hi", eventId: 5 });
  run.send({ type: "end", reason: "idle", eventId: 6 });
  run.end();
  (await session.snapshots.next()).resolve(snapshot(6, "Healed"));
  await session.waitFor((state) => state?.messages[0]?.content === "Healed");

  // The followed run finishing doesn't heal again, and the next run follows the new cursor.
  session.setActivity({ status: "unread" });
  session.setActivity({ status: "running", since: 2 });
  expect((await session.connections.next()).url).toBe("/api/sessions/session?after=6");
  expect(session.snapshots.count).toBe(2);
});

test("heals a run that finished unseen with one snapshot", async () => {
  const session = observeSession();
  session.watch();
  (await session.snapshots.next()).resolve(snapshot(4, "Hello"));
  await session.waitFor((state) => state?.lastSeenEventId === 4);

  session.setActivity({ status: "unread" });
  (await session.snapshots.next()).resolve(snapshot(9, "Finished"));
  await session.waitFor((state) => state?.lastSeenEventId === 9);
  session.setActivity(undefined);
  await settle();

  expect(session.snapshots.count).toBe(2);
  expect(session.connections.count).toBe(0);
});

test("joins a run in progress, resumes a dropped follow from its cursor, and heals an event-less failure", async () => {
  const errors = spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => errors.mockRestore());
  const session = observeSession({ status: "running", since: 1 });
  session.watch();
  (await session.snapshots.next()).resolve(snapshot(4, "Hello"));

  const first = await session.connections.next();
  expect(first.url).toBe("/api/sessions/session?after=4");
  first.send({ type: "assistant_message", content: "Hi", eventId: 5 });
  await session.waitFor((state) => state?.lastSeenEventId === 5);
  first.fail();

  const second = await session.connections.next();
  expect(second.url).toBe("/api/sessions/session?after=5");
  second.fail();
  (await session.snapshots.next()).resolve(snapshot(7, "Healed"));
  await session.waitFor((state) => state?.lastSeenEventId === 7);
  expect(session.connections.count).toBe(2);
});

test("never reads a snapshot during this client's delivery and drops one that returns during it", async () => {
  const session = observeSession();
  session.watch();
  (await session.snapshots.next()).resolve(snapshot(4, "Hello"));
  await session.waitFor((state) => state?.lastSeenEventId === 4);

  session.setActivity({ status: "unread" });
  const heal = await session.snapshots.next();
  session.setActivity({ status: "running", since: 2 });
  const delivery = session.deliver();
  await settle();
  delivery.resolve();
  await settle();
  heal.resolve(snapshot(5, "Stale"));

  const run = await session.connections.next();
  expect(run.url).toBe("/api/sessions/session?after=4");
  expect(session.view()).toMatchObject({ status: "thinking", messages: [{ content: "Hello" }] });
  expect(session.snapshots.count).toBe(2);

  // A follow-up delivered while the run ends defers its heal to the run it starts.
  const followUp = session.deliver();
  run.send({ type: "end", reason: "idle", eventId: 6 });
  run.end();
  await settle();
  expect(session.snapshots.count).toBe(2);
  session.setActivity({ status: "running", since: 3 });
  followUp.resolve();
  const next = await session.connections.next();
  expect(next.url).toBe("/api/sessions/session?after=6");
  next.end();
  (await session.snapshots.next()).resolve(snapshot(8, "Answered"));
  await session.waitFor((state) => state?.messages[0]?.content === "Answered");
});

test("rereads the snapshot after a failed delivery", async () => {
  const session = observeSession();
  session.watch();
  (await session.snapshots.next()).resolve(snapshot(4, "Hello"));
  await session.waitFor((state) => state?.lastSeenEventId === 4);

  session.setActivity({ status: "running", since: 1 });
  const delivery = session.deliver();
  session.setActivity(undefined);
  delivery.reject(new Error("Unable to send."));
  (await session.snapshots.next()).resolve(snapshot(4, "Restored"));
  await session.waitFor((state) => state?.messages[0]?.content === "Restored");
  expect(session.connections.count).toBe(0);
});

test("a failed heal ends the observation quietly and keeps the session's state", async () => {
  const errors = spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => errors.mockRestore());
  const session = observeSession();
  session.watch();
  (await session.snapshots.next()).resolve(snapshot(4, "Hello"));
  await session.waitFor((state) => state?.lastSeenEventId === 4);

  session.setActivity({ status: "unread" });
  (await session.snapshots.next()).reject(new Error("The server restarted."));
  await settle();
  expect(session.query().state).toMatchObject({
    status: "success",
    fetchStatus: "idle",
    error: null,
    data: { lastSeenEventId: 4 },
  });

  session.setActivity({ status: "running", since: 2 });
  await settle();
  expect(session.connections.count).toBe(0);
  expect(session.snapshots.count).toBe(2);
});

test("ends the observation and its follow when the last watcher leaves, even while a pin retains it", async () => {
  const session = observeSession();
  const unwatch = session.watch();
  session.pin();
  (await session.snapshots.next()).resolve(snapshot(4, "Hello"));
  await session.waitFor((state) => state?.lastSeenEventId === 4);
  session.setActivity({ status: "running", since: 1 });
  const run = await session.connections.next();

  unwatch();
  await settle();
  expect(run.signal.aborted).toBe(true);
  expect(session.query().state.fetchStatus).toBe("idle");
  expect(session.view()?.lastSeenEventId).toBe(4);

  session.setActivity({ status: "running", since: 2 });
  await settle();
  expect(session.connections.count).toBe(1);
  expect(session.snapshots.count).toBe(1);
});

test("a watcher that remounts mid-run while a pin retains the detail keeps following", async () => {
  const session = observeSession();
  const unwatch = session.watch();
  session.pin();
  (await session.snapshots.next()).resolve(snapshot(4, "Hello"));
  await session.waitFor((state) => state?.lastSeenEventId === 4);
  session.setActivity({ status: "running", since: 1 });
  const run = await session.connections.next();

  // A layout switch leaves and rewatches the detail in one render.
  unwatch();
  session.watch();
  await settle();
  expect(run.signal.aborted).toBe(true);
  expect(session.snapshots.count).toBe(2);
  (await session.snapshots.next()).resolve(snapshot(5, "Hello"));
  expect((await session.connections.next()).url).toBe("/api/sessions/session?after=5");
});

test("a watcher that remounts before the observation starts reads one snapshot", async () => {
  const session = observeSession();
  // StrictMode and keyed remounts leave and rewatch the detail in one render.
  session.watch()();
  session.watch();
  await settle();
  expect(session.snapshots.count).toBe(1);

  (await session.snapshots.next()).resolve(snapshot(4, "Hello"));
  await session.waitFor((state) => state?.lastSeenEventId === 4);
});

test("a prefetch reads only the snapshot, even while the session runs", async () => {
  const session = observeSession({ status: "running", since: 1 });
  const prefetched = session.client.prefetchQuery(session.options);
  (await session.snapshots.next()).resolve(snapshot(4, "Pinned"));
  await prefetched;

  expect(session.view()?.messages[0]?.content).toBe("Pinned");
  expect(session.query().state.fetchStatus).toBe("idle");
  expect(session.connections.count).toBe(0);
});

test("writes deltas once per frame, and any other event flushes the batch with it", async () => {
  const frames: Array<() => void> = [];
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
  });
  onTestFinished(() => {
    delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
  });
  const session = observeSession({ status: "running", since: 1 });
  session.watch();
  (await session.snapshots.next()).resolve(snapshot(4, "Hello"));
  const run = await session.connections.next();
  const writes = session.countWrites();

  run.send({ type: "delta", content: "Hel", eventId: 5 });
  run.send({ type: "delta", content: "lo", eventId: 6 });
  await settle();
  expect(writes()).toBe(0);
  frames.splice(0).forEach((frame) => frame());
  await session.waitFor((state) => state?.lastSeenEventId === 6);
  expect(writes()).toBe(1);
  expect(session.view()?.messages.at(-1)).toMatchObject({ role: "assistant", content: "Hello" });

  run.send({ type: "delta", content: "!", eventId: 7 });
  run.send({ type: "assistant_message", content: "Hello!", eventId: 8 });
  await session.waitFor((state) => state?.lastSeenEventId === 8);
  await settle();
  expect(writes()).toBe(2);
  expect(session.view()?.messages.at(-1)).toMatchObject({ role: "assistant", content: "Hello!" });
});

type SnapshotRead = {
  resolve(state: SessionState): void;
  reject(error: Error): void;
};

type Connection = {
  url: string;
  signal: AbortSignal;
  send(event: SessionEvent): void;
  end(): void;
  fail(): void;
};

/** One session's detail, observed with scripted snapshot reads and event streams. */
function observeSession(activity?: SessionActivity) {
  const sessionId = "session";
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const activityKey = sessionQueries.activity.queryKey;
  const setActivity = (next?: SessionActivity) =>
    client.setQueryData<SessionsActivity>(activityKey, next ? { [sessionId]: next } : {});
  setActivity(activity);

  const snapshots = queue<SnapshotRead>();
  const options = {
    ...sessionQueries.detail(sessionId),
    queryFn: streamedQuery<SessionObservation, SessionState>({
      initialValue: createInitialSessionState(),
      refetchMode: "append",
      streamFn: (context) =>
        streamSession(context, {
          sessionId,
          activityKey,
          readSnapshot: (signal) => {
            signal.throwIfAborted();
            const read = Promise.withResolvers<SessionState>();
            snapshots.push(read);
            return read.promise;
          },
        }),
      reducer: (state, observation) =>
        observation.type === "snapshot"
          ? adoptSessionSnapshot(state, observation.state)
          : observation.events.reduce(applySessionEvent, state),
    }),
  };
  const key = options.queryKey;

  const connections = queue<Connection>();
  const respond = Object.assign(
    async (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => {
      const signal = init!.signal!;
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      });
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      connections.push({
        url: input as string,
        signal,
        send: (event) =>
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)),
        end: () => controller.close(),
        fail: () => controller.error(new Error("The connection dropped.")),
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    },
    globalThis.fetch,
  );
  const fetch = spyOn(globalThis, "fetch").mockImplementation(respond);
  onTestFinished(() => {
    client.clear();
    fetch.mockRestore();
  });

  const view = () => client.getQueryData<SessionState>(key);
  const query = () => client.getQueryCache().find({ queryKey: key, exact: true })!;
  return {
    client,
    options,
    snapshots,
    connections,
    setActivity,
    view,
    query,
    watch() {
      const unwatch = new QueryObserver(client, options).subscribe(() => {});
      onTestFinished(unwatch);
      return unwatch;
    },
    /** Retains the detail without watching it. */
    pin() {
      onTestFinished(new QueryObserver(client, { ...options, enabled: false }).subscribe(() => {}));
    },
    /** Starts a delivery from this client, settled by the test. */
    deliver() {
      const sent = Promise.withResolvers<void>();
      const observer = new MutationObserver(client, {
        mutationKey: key,
        mutationFn: () => sent.promise,
      });
      void observer.mutate().catch(() => {});
      return sent;
    },
    /** Counts the observation's writes to the detail from now on. */
    countWrites() {
      let writes = 0;
      const { queryHash } = query();
      const stop = client.getQueryCache().subscribe((event) => {
        if (event.query.queryHash !== queryHash) return;
        if (event.type === "updated" && event.action.type === "success") writes++;
      });
      onTestFinished(stop);
      return () => writes;
    },
    waitFor(ready: (state: SessionState | undefined) => boolean): Promise<void> {
      if (ready(view())) return Promise.resolve();
      return new Promise((resolve) => {
        const stop = client.getQueryCache().subscribe(() => {
          if (!ready(view())) return;
          stop();
          resolve();
        });
      });
    },
  };
}

/** Items in arrival order, each awaitable before it arrives. */
function queue<T>() {
  const items: T[] = [];
  let count = 0;
  let arrived = Promise.withResolvers<void>();
  return {
    get count() {
      return count;
    },
    push(item: T) {
      items.push(item);
      count++;
      arrived.resolve();
    },
    async next(): Promise<T> {
      while (items.length === 0) {
        arrived = Promise.withResolvers<void>();
        await arrived.promise;
      }
      return items.shift()!;
    },
  };
}

/** Lets pending stream reads, writes, and timers run. */
const settle = () => Bun.sleep(10);
