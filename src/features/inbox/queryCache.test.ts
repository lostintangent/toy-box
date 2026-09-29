import { expect, onTestFinished, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { applyWorkspaceEvent, workspaceQueries } from "@workspace/queries";
import { createEmptyWorkspaceState, type WorkspaceState } from "@workspace/model/state/reducer";
import type { InboxEntry } from "./model";
import { inboxQueries } from "./queries";
import { applyInboxListEvent } from "./queryCache";

const entry: InboxEntry = {
  id: "inbox",
  createdAt: new Date(0).toISOString(),
  kind: "result",
  message: "Ready",
};

test("Inbox events own their cache and leave workspace facts fresh and unchanged", async () => {
  const client = createClient();
  const workspace = createEmptyWorkspaceState();
  client.setQueryData(workspaceQueries.stateKey(), workspace);
  client.setQueryData(inboxQueries.listKey(), [entry]);
  applyWorkspaceEvent(client, { type: "inbox.changed" });
  await Bun.sleep(0);
  expect(client.getQueryState(inboxQueries.listKey())?.isInvalidated).toBe(true);
  expect(client.getQueryState(workspaceQueries.stateKey())?.isInvalidated).toBe(false);
  expect(client.getQueryData<WorkspaceState>(workspaceQueries.stateKey())).toBe(workspace);
  applyWorkspaceEvent(client, { type: "inbox.entry.deleted", entryId: entry.id });
  expect(client.getQueryData<InboxEntry[]>(inboxQueries.listKey())).toEqual([]);
});

test.each([false, true])(
  "hints replace overlapping reads, including initial loads (cached=%s)",
  async (cached) => {
    const client = createClient();
    const old = Promise.withResolvers<InboxEntry[]>();
    const current = Promise.withResolvers<InboxEntry[]>();
    if (cached) client.setQueryData(inboxQueries.listKey(), [entry]);
    let reads = 0;
    const observer = new QueryObserver(client, {
      ...inboxQueries.list(),
      staleTime: 0,
      queryFn: () => (++reads === 1 ? old.promise : current.promise),
    });
    onTestFinished(observer.subscribe(() => {}));
    applyInboxListEvent(client, { type: "inbox.changed" });
    await Bun.sleep(0);
    const latest = [{ ...entry, message: "Updated" }];
    current.resolve(latest);
    await Bun.sleep(0);
    old.resolve([entry]);
    await Bun.sleep(0);
    expect(client.getQueryData<InboxEntry[]>(inboxQueries.listKey())).toEqual(latest);
  },
);

test.each([false, true])(
  "deletion cannot be undone by an overlapping snapshot (cached=%s)",
  async (cached) => {
    const client = createClient();
    const old = Promise.withResolvers<InboxEntry[]>();
    if (cached) client.setQueryData(inboxQueries.listKey(), [entry]);
    const other = { ...entry, id: "other" };
    let reads = 0;
    const observer = new QueryObserver(client, {
      ...inboxQueries.list(),
      staleTime: 0,
      queryFn: () => (++reads === 1 ? old.promise : Promise.resolve([other])),
    });
    onTestFinished(observer.subscribe(() => {}));
    applyInboxListEvent(client, { type: "inbox.entry.deleted", entryId: entry.id });
    expect(client.getQueryData<InboxEntry[]>(inboxQueries.listKey())).toEqual(
      cached ? [] : undefined,
    );
    await Bun.sleep(0);
    old.resolve([entry]);
    await Bun.sleep(0);
    expect(client.getQueryData<InboxEntry[]>(inboxQueries.listKey())).toEqual([other]);
  },
);

function createClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  onTestFinished(() => client.clear());
  return client;
}
