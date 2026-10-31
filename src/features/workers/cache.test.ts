import { expect, onTestFinished, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { sessionFile } from "@files/model";
import type { Worker } from "./model";
import { workerQueries } from "./queries";
import cache from "./cache";

const fileWorker: Worker = {
  createdAt: new Date(0).toISOString(),
  type: "file",
  sessionId: "file-worker",
  ephemeral: true,
  file: sessionFile("session-a", "plan.md"),
  name: "Respond to comment",
  metadata: { threadId: "thread-a" },
};
const appWorker: Worker = {
  createdAt: new Date(0).toISOString(),
  type: "app",
  sessionId: "app-worker",
  appId: "app-a",
  ephemeral: true,
};
const otherAppWorker: Worker = { ...appWorker, sessionId: "other-app-worker", appId: "app-b" };

test("tracks started and finished workers idempotently", () => {
  const client = createClient([]);
  cache.applyEvent(client, { type: "worker.started", worker: fileWorker });
  const started = workers(client);
  expect(started).toEqual([fileWorker]);

  cache.applyEvent(client, { type: "worker.started", worker: fileWorker });
  expect(workers(client)).toBe(started);

  cache.applyEvent(client, { type: "worker.finished", sessionId: fileWorker.sessionId });
  const finished = workers(client);
  expect(finished).toEqual([]);
  cache.applyEvent(client, { type: "worker.finished", sessionId: fileWorker.sessionId });
  expect(workers(client)).toBe(finished);
});

test("deleting a session ends its own worker and the workers it owns", () => {
  const ownWorker: Worker = { ...appWorker, sessionId: "session-a" };
  const client = createClient([ownWorker, fileWorker, otherAppWorker]);

  cache.applyEvent(client, { type: "session.deleted", sessionId: "session-a" });

  expect(workers(client)).toEqual([otherAppWorker]);
});

test("deleting an app removes only its workers", () => {
  const client = createClient([appWorker, otherAppWorker, fileWorker]);
  const event = { type: "app.deleted", appId: appWorker.appId } as const;

  cache.applyEvent(client, event);
  const remaining = workers(client);
  expect(remaining).toEqual([otherAppWorker, fileWorker]);
  cache.applyEvent(client, event);
  expect(workers(client)).toBe(remaining);
});

test("leaves an unloaded list for its first read", () => {
  const client = createClient();
  cache.applyEvent(client, { type: "worker.started", worker: fileWorker });
  expect(workers(client)).toBeUndefined();
});

function createClient(initial?: Worker[]): QueryClient {
  const client = new QueryClient();
  onTestFinished(() => client.clear());
  if (initial) client.setQueryData(workerQueries.activeKey(), initial);
  return client;
}

function workers(client: QueryClient): Worker[] | undefined {
  return client.getQueryData(workerQueries.activeKey());
}
