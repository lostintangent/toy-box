import { describe, expect, onTestFinished, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { AppDefinition, AppInstance, AppList, AppShare } from "./model";
import { appQueries } from "./queries";
import { applyAppListEvent, invalidateAppListQuery } from "./queryCache";

const definition: AppDefinition = {
  id: "kanban",
  title: "Kanban",
  color: "#f59e0b",
  state: { schema: { type: "object" }, default: {} },
  accepts: ["text/plain"],
  revision: "definition-a",
};
const app: AppInstance = {
  id: "app-a",
  definitionId: definition.id,
  title: "Launch board",
  color: definition.color,
  state: {},
  revision: 0,
  createdAt: "2026-07-28T12:00:00.000Z",
  updatedAt: "2026-07-28T12:00:00.000Z",
};
const share: AppShare = {
  id: "share-a",
  sourceAppId: app.id,
  targetAppId: "app-b",
  mimeType: "text/plain",
  content: "Ship it",
  createdAt: "2026-07-28T12:02:00.000Z",
};

describe("Apps catalog cache", () => {
  test("live events leave initial loading to the complete snapshot", () => {
    const client = createQueryClient();
    applyAppListEvent(client, { type: "app.upserted", app });
    expect(client.getQueryData(appQueries.listKey())).toBeUndefined();
  });

  test("definition registration replaces revisions and preserves duplicate identity", () => {
    const client = createQueryClient(emptyList());
    applyAppListEvent(client, { type: "app.registered", definition });
    const registered = readList(client);
    expect(registered.definitions).toEqual([definition]);
    applyAppListEvent(client, { type: "app.registered", definition: { ...definition } });
    expect(readList(client)).toBe(registered);

    const updated = { ...definition, title: "Updated board", revision: "definition-b" };
    applyAppListEvent(client, { type: "app.registered", definition: updated });
    expect(readList(client).definitions).toEqual([updated]);
    applyAppListEvent(client, { type: "app.unregistered", definitionId: definition.id });
    expect(readList(client).definitions).toEqual([]);
    const removed = readList(client);
    applyAppListEvent(client, { type: "app.unregistered", definitionId: definition.id });
    expect(readList(client)).toBe(removed);
  });

  test("saved apps stay title-sorted and advance only to newer revisions", () => {
    const client = createQueryClient(emptyList());
    const first = { ...app, id: "app-b", title: "Alpha board" };
    applyAppListEvent(client, { type: "app.upserted", app });
    applyAppListEvent(client, { type: "app.upserted", app: first });
    expect(readList(client).apps).toEqual([first, app]);

    const updated = { ...app, state: { count: 1 }, revision: 1 };
    applyAppListEvent(client, { type: "app.upserted", app: updated });
    const latest = readList(client);
    expect(latest.apps).toEqual([first, updated]);
    applyAppListEvent(client, { type: "app.upserted", app });
    applyAppListEvent(client, { type: "app.upserted", app: { ...updated } });
    expect(readList(client)).toBe(latest);
  });

  test("shares follow target ownership while source deletion clears only provenance", () => {
    const target = { ...app, id: share.targetAppId };
    const client = createQueryClient({
      apps: [app, target],
      definitions: [definition],
      shares: [],
    });
    applyAppListEvent(client, { type: "app.share.created", share });
    const shared = readList(client);
    applyAppListEvent(client, { type: "app.share.created", share: { ...share } });
    expect(readList(client)).toBe(shared);
    applyAppListEvent(client, { type: "app.share.deleted", shareId: share.id });
    expect(readList(client).shares).toEqual([]);
    const consumed = readList(client);
    applyAppListEvent(client, { type: "app.share.deleted", shareId: share.id });
    expect(readList(client)).toBe(consumed);

    applyAppListEvent(client, { type: "app.share.created", share });
    applyAppListEvent(client, { type: "app.deleted", appId: app.id });
    expect(readList(client)).toEqual({
      apps: [target],
      definitions: [definition],
      shares: [{ ...share, sourceAppId: null }],
    });
    applyAppListEvent(client, { type: "app.deleted", appId: target.id });
    expect(readList(client)).toEqual({ apps: [], definitions: [definition], shares: [] });
  });

  test.each(["app.upserted", "app.deleted"] as const)(
    "%s replaces an overlapping snapshot with an authoritative read",
    async (type) => {
      const stale = { apps: [app], definitions: [definition], shares: [] };
      const client = createQueryClient(stale);
      const held = Promise.withResolvers<AppList>();
      const updated = { ...app, state: { count: 2 }, revision: 2 };
      const latest = { ...stale, apps: type === "app.upserted" ? [updated] : [] };
      let reads = 0;
      const pending = client.fetchQuery({
        ...appQueries.list(),
        staleTime: 0,
        queryFn: () => (++reads === 1 ? held.promise : Promise.resolve(latest)),
      });

      applyAppListEvent(
        client,
        type === "app.upserted"
          ? { type, app: { ...updated, revision: 1 } }
          : { type, appId: app.id },
      );
      held.resolve(stale);
      await pending;
      expect(readList(client)).toEqual(latest);
      expect(reads).toBe(2);
    },
  );

  test("reconnect invalidation refreshes the catalog without invalidating compiled bundles", async () => {
    const client = createQueryClient(emptyList());
    const bundleKey = appQueries.bundle(definition.id, definition.revision).queryKey;
    client.setQueryData(bundleKey, { Component: () => null, css: "" });
    await invalidateAppListQuery(client);
    expect(client.getQueryState(appQueries.listKey())?.isInvalidated).toBe(true);
    expect(client.getQueryState(bundleKey)?.isInvalidated).toBe(false);
  });
});

function emptyList(): AppList {
  return { apps: [], definitions: [], shares: [] };
}

function createQueryClient(list?: AppList): QueryClient {
  const client = new QueryClient();
  if (list) client.setQueryData(appQueries.listKey(), list);
  onTestFinished(() => client.clear());
  return client;
}

function readList(client: QueryClient): AppList {
  return client.getQueryData<AppList>(appQueries.listKey())!;
}
