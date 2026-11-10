import { describe, expect, onTestFinished, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { reducedQuery } from "./query";

describe("reduced query", () => {
  test("reconciles a snapshot with every event applied during its read", async () => {
    const { query, snapshots } = declareQuery();
    const client = createQueryClient();
    const snapshot = Promise.withResolvers<string[]>();
    snapshots.push(snapshot.promise);

    const fetch = client.fetchQuery(query);
    query.apply(client, "live");
    expect(client.getQueryData(query.queryKey)).toBeUndefined();

    snapshot.resolve(["snapshot"]);
    expect(await fetch).toEqual(["snapshot", "live"]);
  });

  test("a refresh carries buffered events into its replacement read", async () => {
    const { query, snapshots } = declareQuery();
    const client = createQueryClient();
    const [first, second] = [Promise.withResolvers<string[]>(), Promise.withResolvers<string[]>()];
    snapshots.push(first.promise, second.promise);
    client.setQueryData(query.queryKey, []);

    observe(client, query);
    query.apply(client, "live");
    const refreshed = query.refresh(client);
    await Bun.sleep(0);

    first.resolve(["stale"]);
    await Bun.sleep(0);
    expect(client.getQueryData(query.queryKey)).toEqual(["live"]);

    second.resolve(["fresh"]);
    await refreshed;
    expect(client.getQueryData(query.queryKey)).toEqual(["fresh", "live"]);
  });

  test("a refresh replaces an initial read still in flight", async () => {
    const { query, snapshots } = declareQuery();
    const client = createQueryClient();
    const [first, second] = [Promise.withResolvers<string[]>(), Promise.withResolvers<string[]>()];
    snapshots.push(first.promise, second.promise);

    observe(client, query);
    const refreshed = query.refresh(client);
    await Bun.sleep(0);

    second.resolve(["fresh"]);
    first.resolve(["stale"]);
    await refreshed;
    expect(client.getQueryData(query.queryKey)).toEqual(["fresh"]);
  });

  test("keeps live data when a snapshot read fails", async () => {
    const { query, snapshots } = declareQuery();
    const client = createQueryClient();
    const snapshot = Promise.withResolvers<string[]>();
    snapshots.push(snapshot.promise);
    client.setQueryData(query.queryKey, []);

    const fetch = client.fetchQuery({ ...query, staleTime: 0, retry: false });
    query.apply(client, "live");
    snapshot.reject(new Error("snapshot failed"));

    await expect(fetch).rejects.toThrow("snapshot failed");
    expect(client.getQueryData(query.queryKey)).toEqual(["live"]);
  });

  test("repair keeps a rejected event out of the replacement read", async () => {
    const { query, snapshots } = declareQuery();
    const client = createQueryClient();
    const [first, second] = [Promise.withResolvers<string[]>(), Promise.withResolvers<string[]>()];
    snapshots.push(first.promise, second.promise);
    client.setQueryData(query.queryKey, []);

    observe(client, query);
    query.apply(client, "rejected");
    const repaired = query.repair(client);
    await Bun.sleep(0);

    first.resolve(["authoritative"]);
    second.resolve(["authoritative"]);
    await repaired;
    expect(client.getQueryData(query.queryKey)).toEqual(["authoritative"]);
  });

  test("keeps each QueryClient's buffered events to itself", async () => {
    const { query, snapshots } = declareQuery();
    const [left, right] = [createQueryClient(), createQueryClient()];
    snapshots.push(Promise.resolve([]), Promise.resolve([]));
    const leftFetch = left.fetchQuery(query);
    const rightFetch = right.fetchQuery(query);

    query.apply(left, "left only");

    expect(await leftFetch).toEqual(["left only"]);
    expect(await rightFetch).toEqual([]);
  });
});

/** A declared query whose reads resolve the queued snapshots in order. */
function declareQuery() {
  const snapshots: Promise<string[]>[] = [];
  const query = reducedQuery({
    queryKey: ["reduced"],
    fetch: () => snapshots.shift()!,
    reduce: (state: string[], event: string) => [...state, event],
  });
  return { query, snapshots };
}

/** Refreshes only refetch observed queries, as the app's always are. */
function observe(client: QueryClient, query: ReturnType<typeof declareQuery>["query"]) {
  const observer = new QueryObserver(client, { ...query, staleTime: 0 });
  onTestFinished(observer.subscribe(() => {}));
}

function createQueryClient(): QueryClient {
  const client = new QueryClient();
  onTestFinished(() => client.clear());
  return client;
}
