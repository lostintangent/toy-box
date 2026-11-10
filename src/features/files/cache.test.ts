import { describe, expect, onTestFinished, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { machineFile, workspaceFileId } from "./model";
import { fileQueries } from "./queries";
import cache from "./cache";

function createClient(): QueryClient {
  const client = new QueryClient();
  onTestFinished(() => client.clear());
  return client;
}

describe("file changes", () => {
  const file = machineFile("/repo/notes.md");
  const key = fileQueries.detailKey(workspaceFileId(file));
  const snapshot = { content: "Before", timestamp: 1 };

  test("a newer version rereads only that file", () => {
    const client = createClient();
    const otherKey = fileQueries.detailKey(workspaceFileId(machineFile("/repo/other.md")));
    client.setQueryData(key, snapshot);
    client.setQueryData(otherKey, snapshot);

    cache.applyEvent(client, { type: "file.changed", file, timestamp: 2 });

    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  test("a version this tab already has, such as its own save, is no news", () => {
    const client = createClient();
    client.setQueryData(key, snapshot);

    cache.applyEvent(client, { type: "file.changed", file, timestamp: snapshot.timestamp });

    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  test("a deletion clears the file", () => {
    const client = createClient();
    client.setQueryData(key, snapshot);

    cache.applyEvent(client, { type: "file.deleted", file });

    expect(client.getQueryData(key)).toBeNull();
  });

  test("a file this tab hasn't read is left alone", () => {
    const client = createClient();

    cache.applyEvent(client, { type: "file.deleted", file });
    cache.applyEvent(client, { type: "file.changed", file, timestamp: 2 });

    expect(client.getQueryState(key)).toBeUndefined();
  });
});
