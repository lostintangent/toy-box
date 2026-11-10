import { expect, onTestFinished, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { workspaceQueries } from "@workspace/queries";
import { applyWorkspaceEvent } from "@workspace/sync";
import { createEmptyWorkspaceState } from "@workspace/model/state/reducer";
import type { InboxEntry } from "./model";
import { inboxQueries } from "./queries";

const entry: InboxEntry = {
  id: "inbox",
  createdAt: new Date(0).toISOString(),
  kind: "result",
  message: "Ready",
};

test("Inbox events own their cache and leave workspace facts fresh and unchanged", async () => {
  const client = createClient();
  const workspace = createEmptyWorkspaceState();
  client.setQueryData(workspaceQueries.state.queryKey, workspace);
  client.setQueryData(inboxQueries.list.queryKey, [entry]);
  applyWorkspaceEvent(client, { type: "inbox.changed" });
  await Bun.sleep(0);
  expect(client.getQueryState(inboxQueries.list.queryKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(workspaceQueries.state.queryKey)?.isInvalidated).toBe(false);
  expect(client.getQueryData(workspaceQueries.state.queryKey)).toBe(workspace);
  applyWorkspaceEvent(client, { type: "session.deleted", sessionId: entry.id });
  expect(client.getQueryData(inboxQueries.list.queryKey)).toEqual([]);
});

function createClient(): QueryClient {
  const client = new QueryClient();
  onTestFinished(() => client.clear());
  return client;
}
