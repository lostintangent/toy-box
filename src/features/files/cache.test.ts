import { describe, expect, onTestFinished, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { machineFile, workspaceFileId, type CustomEditorKind } from "./model";
import { fileQueries } from "./queries";
import cache from "./cache";

const kind: CustomEditorKind = {
  name: "json-tree",
  extensions: ["json"],
  icon: "json",
  editable: false,
  html: "<html>first</html>",
};

test("registering an editor adds it, then replaces it by name", () => {
  const client = createClient([]);
  cache.applyEvent(client, { type: "editor.registered", kind });
  const registered = editors(client);
  expect(registered).toEqual([kind]);

  cache.applyEvent(client, { type: "editor.registered", kind });
  expect(editors(client)).toBe(registered);

  const updated = { ...kind, editable: true, html: "<html>updated</html>" };
  cache.applyEvent(client, { type: "editor.registered", kind: updated });
  expect(editors(client)).toEqual([updated]);
});

test("leaves an unloaded list for its first read", () => {
  const client = createClient();
  cache.applyEvent(client, { type: "editor.registered", kind });
  expect(editors(client)).toBeUndefined();
});

function createClient(initial?: CustomEditorKind[]): QueryClient {
  const client = new QueryClient();
  onTestFinished(() => client.clear());
  if (initial) client.setQueryData(fileQueries.editorsKey(), initial);
  return client;
}

function editors(client: QueryClient): CustomEditorKind[] | undefined {
  return client.getQueryData(fileQueries.editorsKey());
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
