import { expect, onTestFinished, spyOn, test } from "bun:test";
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import type { SessionState, SessionSubscriptionEvent } from "./model";
import type { SessionActivity, SessionsActivity } from "./model/activity";
import { createInitialSessionState } from "./model/reducer";
import { sessionQueries } from "./queries";

const snapshot = (revision: number, content: string): SessionSubscriptionEvent => ({
  type: "snapshot",
  state: createInitialSessionState({ revision, messages: [{ role: "user", content }] }),
});

/** Watches the detail and brings it current with an idle session's snapshot. */
async function openIdle(session: ReturnType<typeof watchSession>, revision = 4) {
  const unwatch = session.watch();
  const open = await session.connections.next();
  open.send(snapshot(revision, "Hello"));
  open.end();
  await session.waitFor((state) => state?.revision === revision);
  return unwatch;
}

test("opens with a subscription, and subscribes to each announced run from its revision", async () => {
  const session = watchSession();
  session.watch();
  const open = await session.connections.next();
  expect(open.url).toBe("/api/sessions/session");
  open.send(snapshot(4, "Hello"));
  open.end();
  await session.waitFor((state) => state?.revision === 4);

  session.setActivity({ status: "running", since: 1 });
  const run = await session.connections.next();
  expect(run.url).toBe("/api/sessions/session?after=4");
  run.send({ type: "resumed" });
  run.send({ type: "assistant_message", content: "Hi", revision: 5 });
  run.send({ type: "end", reason: "idle", revision: 6 });
  run.end();
  await session.waitFor((state) => state?.revision === 6);
  expect(session.view()?.messages.map(({ content }) => content)).toEqual(["Hello", "Hi"]);

  // The subscribed run finishing needs nothing more, and the next run subscribes from the new revision.
  session.setActivity({ status: "unread" });
  session.setActivity({ status: "running", since: 2 });
  expect((await session.connections.next()).url).toBe("/api/sessions/session?after=6");
  expect(session.connections.count).toBe(3);
});

test("subscribes once to a run that finished unseen", async () => {
  const session = watchSession();
  await openIdle(session);

  session.setActivity({ status: "unread" });
  const caughtUp = await session.connections.next();
  expect(caughtUp.url).toBe("/api/sessions/session?after=4");
  caughtUp.send(snapshot(9, "Finished"));
  caughtUp.end();
  await session.waitFor((state) => state?.revision === 9);
  session.setActivity(undefined);
  await settle();

  expect(session.connections.count).toBe(2);
});

test("subscribes again when a followed run is stopped, since its history can keep less", async () => {
  const session = watchSession();
  await openIdle(session);
  session.setActivity({ status: "running", since: 1 });
  const run = await session.connections.next();
  run.send({ type: "resumed" });
  run.send({ type: "assistant_message", content: "Partial", revision: 5 });
  run.send({ type: "end", reason: "idle", revision: 6 });
  run.end();
  await session.waitFor((state) => state?.revision === 6);

  session.setActivity(undefined);
  const stopped = await session.connections.next();
  expect(stopped.url).toBe("/api/sessions/session?after=6");
  stopped.send(snapshot(9, "Hello"));
  stopped.end();
  await session.waitFor((state) => state?.revision === 9);
  expect(session.view()?.messages.map(({ content }) => content)).toEqual(["Hello"]);
});

test("joins a run in progress, and resubscribes from its revision after a dropped subscription", async () => {
  const errors = spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => errors.mockRestore());
  const session = watchSession({ status: "running", since: 1 });
  session.watch();

  const first = await session.connections.next();
  first.send(snapshot(4, "Hello"));
  first.send({ type: "assistant_message", content: "Hi", revision: 5 });
  await session.waitFor((state) => state?.revision === 5);
  first.fail();

  const second = await session.connections.next();
  expect(second.url).toBe("/api/sessions/session?after=5");
  second.send({ type: "resumed" });
  second.send({ type: "end", reason: "idle", revision: 6 });
  second.end();
  await session.waitFor((state) => state?.status === "idle" && state.revision === 6);
});

test("fails the detail when its opening subscription finds no session", async () => {
  const session = watchSession();
  session.watch();
  const open = await session.connections.next();
  open.send({ type: "deleted", sessionId: "session" });
  open.end();
  await settle();

  expect(session.query().state.status).toBe("error");
  expect(session.query().state.error?.message).toContain("Session not found");
});

test("a later subscription that fails before any event ends quietly and keeps the session's state", async () => {
  const errors = spyOn(console, "error").mockImplementation(() => {});
  onTestFinished(() => errors.mockRestore());
  const session = watchSession();
  await openIdle(session);

  session.setActivity({ status: "running", since: 1 });
  (await session.connections.next()).fail();
  await settle();
  expect(session.query().state).toMatchObject({
    status: "success",
    fetchStatus: "idle",
    error: null,
    data: { revision: 4 },
  });

  session.setActivity({ status: "running", since: 2 });
  await settle();
  expect(session.connections.count).toBe(2);
});

test("waits for this client's delivery, and drops a snapshot that one started during", async () => {
  const session = watchSession();
  await openIdle(session);

  const delivery = session.deliver();
  session.setActivity({ status: "running", since: 1 });
  await settle();
  expect(session.connections.count).toBe(1);
  delivery.resolve();
  const run = await session.connections.next();
  expect(run.url).toBe("/api/sessions/session?after=4");

  // A follow-up starts before the subscription brings the detail current.
  const followUp = session.deliver();
  run.send(snapshot(5, "Stale"));
  await settle();
  expect(run.signal.aborted).toBe(true);
  expect(session.view()?.messages[0]?.content).toBe("Hello");

  followUp.resolve();
  expect((await session.connections.next()).url).toBe("/api/sessions/session?after=4");
});

test("ends the subscription when the last watcher leaves, even while a pin retains it", async () => {
  const session = watchSession();
  session.pin();
  const unwatch = await openIdle(session);
  session.setActivity({ status: "running", since: 1 });
  const run = await session.connections.next();

  unwatch();
  await settle();
  expect(run.signal.aborted).toBe(true);
  expect(session.query().state.fetchStatus).toBe("idle");
  expect(session.view()?.revision).toBe(4);

  session.setActivity({ status: "running", since: 2 });
  await settle();
  expect(session.connections.count).toBe(2);
});

test("a watcher that remounts mid-run while a pin retains the detail resubscribes", async () => {
  const session = watchSession();
  session.pin();
  const unwatch = await openIdle(session);
  session.setActivity({ status: "running", since: 1 });
  const run = await session.connections.next();

  // A layout switch leaves and rewatches the detail in one render.
  unwatch();
  session.watch();
  await settle();
  expect(run.signal.aborted).toBe(true);
  expect((await session.connections.next()).url).toBe("/api/sessions/session?after=4");
});

test("a watcher that remounts before the subscription opens subscribes once", async () => {
  const session = watchSession();
  // StrictMode and keyed remounts leave and rewatch the detail in one render.
  session.watch()();
  session.watch();
  await settle();
  expect(session.connections.count).toBe(1);

  (await session.connections.next()).send(snapshot(4, "Hello"));
  await session.waitFor((state) => state?.revision === 4);
});

test("a prefetch closes its subscription once the detail is current, even while the session runs", async () => {
  const session = watchSession({ status: "running", since: 1 });
  const prefetched = session.client.prefetchQuery(session.options);
  const open = await session.connections.next();
  open.send(snapshot(4, "Pinned"));
  await prefetched;

  expect(open.signal.aborted).toBe(true);
  expect(session.view()?.messages[0]?.content).toBe("Pinned");
  expect(session.query().state.fetchStatus).toBe("idle");
  expect(session.connections.count).toBe(1);
});

test("writes deltas once per frame, and any other event flushes the batch with it", async () => {
  const frames: Array<() => void> = [];
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
  });
  onTestFinished(() => {
    delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
  });
  const session = watchSession({ status: "running", since: 1 });
  session.watch();
  const run = await session.connections.next();
  run.send(snapshot(4, "Hello"));
  await session.waitFor((state) => state?.revision === 4);
  const writes = session.countWrites();

  run.send({ type: "delta", content: "Hel", revision: 5 });
  run.send({ type: "delta", content: "lo", revision: 6 });
  await settle();
  expect(writes()).toBe(0);
  frames.splice(0).forEach((frame) => frame());
  await session.waitFor((state) => state?.revision === 6);
  expect(writes()).toBe(1);
  expect(session.view()?.messages.at(-1)).toMatchObject({ role: "assistant", content: "Hello" });

  run.send({ type: "delta", content: "!", revision: 7 });
  run.send({ type: "assistant_message", content: "Hello!", revision: 8 });
  await session.waitFor((state) => state?.revision === 8);
  await settle();
  expect(writes()).toBe(2);
  expect(session.view()?.messages.at(-1)).toMatchObject({ role: "assistant", content: "Hello!" });
});

type Connection = {
  url: string;
  signal: AbortSignal;
  send(event: SessionSubscriptionEvent): void;
  end(): void;
  fail(): void;
};

/** One session's detail, watched with scripted subscriptions. */
function watchSession(activity?: SessionActivity) {
  const sessionId = "session";
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const activityKey = sessionQueries.activity.queryKey;
  const setActivity = (next?: SessionActivity) =>
    client.setQueryData<SessionsActivity>(activityKey, next ? { [sessionId]: next } : {});
  setActivity(activity);

  const options = sessionQueries.detail(sessionId);
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
    /** Counts the subscription's writes to the detail from now on. */
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
