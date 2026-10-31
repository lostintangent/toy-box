import { describe, expect, onTestFinished, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { snapshotJournal } from "./query";

const queryKey = ["journal"] as const;
const journal = snapshotJournal<string[], string>(queryKey, (state, event) => [...state, event]);

describe("snapshot journal", () => {
  test("reconciles a snapshot with every event applied during its read", async () => {
    const queryClient = createQueryClient();
    const snapshot = Promise.withResolvers<string[]>();

    const fetch = queryClient.fetchQuery({
      queryKey,
      queryFn: ({ client }) => journal.read(client, () => snapshot.promise),
      retry: false,
    });
    journal.apply(queryClient, "live");
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();

    snapshot.resolve(["snapshot"]);
    await fetch;
    expect(queryClient.getQueryData(queryKey)).toEqual(["snapshot", "live"]);
  });

  test("carries buffered events into a replacement read", async () => {
    const queryClient = createQueryClient();
    const first = Promise.withResolvers<string[]>();
    const second = Promise.withResolvers<string[]>();
    const snapshots = [first.promise, second.promise];
    queryClient.setQueryData(queryKey, []);
    const query = {
      queryKey,
      queryFn: ({ client }: { client: QueryClient }) =>
        journal.read(client, () => snapshots.shift()!),
      retry: false,
      staleTime: 0,
    };

    const firstFetch = queryClient.fetchQuery(query);
    journal.apply(queryClient, "live");
    const replacementFetch = queryClient.refetchQueries(
      { queryKey, exact: true },
      { throwOnError: true },
    );

    first.resolve(["stale"]);
    await Promise.resolve();
    expect(queryClient.getQueryData(queryKey)).toEqual(["live"]);

    second.resolve(["fresh"]);
    await Promise.all([firstFetch, replacementFetch]);
    expect(queryClient.getQueryData(queryKey)).toEqual(["fresh", "live"]);
  });

  test("keeps live data when a snapshot read fails", async () => {
    const queryClient = createQueryClient();
    const snapshot = Promise.withResolvers<string[]>();
    queryClient.setQueryData(queryKey, []);

    const fetch = queryClient.fetchQuery({
      queryKey,
      queryFn: ({ client }) => journal.read(client, () => snapshot.promise),
      retry: false,
      staleTime: 0,
    });
    journal.apply(queryClient, "live");
    snapshot.reject(new Error("snapshot failed"));

    await expect(fetch).rejects.toThrow("snapshot failed");
    expect(queryClient.getQueryData(queryKey)).toEqual(["live"]);
  });

  test("repair keeps a rejected event out of every snapshot already in flight", async () => {
    const queryClient = createQueryClient();
    const first = Promise.withResolvers<string[]>();
    const second = Promise.withResolvers<string[]>();
    const snapshots = [first.promise, second.promise];
    queryClient.setQueryData(queryKey, []);
    const firstRead = journal.read(queryClient, () => snapshots.shift()!);

    journal.apply(queryClient, "rejected");
    const repaired = journal.repair(queryClient);
    const replacementRead = journal.read(queryClient, () => snapshots.shift()!);

    first.resolve(["authoritative"]);
    second.resolve(["authoritative"]);
    expect(await firstRead).toEqual(["authoritative"]);
    expect(await replacementRead).toEqual(["authoritative"]);
    await repaired;
  });

  test("keeps each QueryClient's buffered events to itself", async () => {
    const [left, right] = [createQueryClient(), createQueryClient()];
    const leftSnapshot = Promise.withResolvers<string[]>();
    const rightSnapshot = Promise.withResolvers<string[]>();
    const leftRead = journal.read(left, () => leftSnapshot.promise);
    const rightRead = journal.read(right, () => rightSnapshot.promise);

    journal.apply(left, "left only");
    leftSnapshot.resolve([]);
    rightSnapshot.resolve([]);

    expect(await leftRead).toEqual(["left only"]);
    expect(await rightRead).toEqual([]);
  });
});

function createQueryClient(): QueryClient {
  const queryClient = new QueryClient();
  onTestFinished(() => queryClient.clear());
  return queryClient;
}
