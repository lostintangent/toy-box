import { expect, mock, onTestFinished, spyOn, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { channelLead, type ChannelCatalogEntry, type ChannelList } from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { channelQueries, type ChannelQueryData } from "@channels/queries";
import { workspaceQueries } from "@workspace/queries";
import { createEmptyWorkspaceState } from "@workspace/model/state/reducer";
import cache, { loadChannelHistory } from "./cache";
import type { ChannelConversationMessage, ChannelState } from "./model";

const channel: ChannelCatalogEntry = {
  id: "channel",
  name: "Planning",
  purpose: "Prepare the release plan.",
  model: { provider: "copilot", name: "gpt-5.5" },
  latestSequence: 0,
  seenThrough: 0,
  completedSequence: null,
  requestSequence: null,
  updatedAt: "2026-09-05T12:00:00.000Z",
  revision: 101,
  request: null,
};

const message: ChannelConversationMessage = {
  id: "latest",
  sequence: 101,
  timestamp: channel.updatedAt,
  sender: { type: "user" },
  content: "Latest",
};
const older = { ...message, id: "older", sequence: 100 };
const snapshot: ChannelQueryData = {
  arrival: { id: 1, unreadAfter: 0 },
  channel: { ...channel, tasks: [], latestSequence: message.sequence },
  request: null,
  bookmarks: [],
  revision: 101,
  lead: channelLead(channel.id),
  members: [],
  messages: [message],
  artifacts: [],
  routines: [],
};
const detailKey = channelQueries.detail(channel.id).queryKey;

test("catalog membership follows workspace events without touching detail state", () => {
  const client = createQueryClient();
  const key = channelQueries.list.queryKey;
  client.setQueryData(key, { channels: [channel], members: [] });
  client.setQueryData(detailKey, snapshot);
  const member = { id: "reviewer", channelId: channel.id, name: "Reviewer" };
  cache.applyEvent(client, { type: "channel.member.upserted", member });
  cache.applyEvent(client, {
    type: "channel.member.upserted",
    member: { ...member, name: "Ada" },
  });
  expect(client.getQueryData<ChannelList>(key)?.members).toEqual([{ ...member, name: "Ada" }]);
  cache.applyEvent(client, {
    type: "channel.member.deleted",
    channelId: channel.id,
    agentId: member.id,
  });
  expect(client.getQueryData<ChannelList>(key)).toEqual({ channels: [channel], members: [] });
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  expect(client.getQueryData<ChannelQueryData>(detailKey)).toEqual(snapshot);
});

test("concurrent history reads preserve a reaction posted while the older page was loading", async () => {
  const client = createQueryClient();
  client.setQueryData(detailKey, snapshot);
  const held = Promise.withResolvers<Pick<ChannelState, "revision" | "messages">>();
  const updated = { ...older, reactions: [{ agentId: "reviewer", reaction: "agree" as const }] };
  mockHistory()
    .mockReturnValueOnce(held.promise)
    .mockResolvedValue({ revision: 102, messages: [updated] });
  const first = loadChannelHistory(client, channel.id);
  client.setQueryData<ChannelQueryData>(detailKey, {
    ...snapshot,
    revision: 102,
  });
  const second = loadChannelHistory(client, channel.id);
  held.resolve({ revision: 101, messages: [older] });
  await Promise.all([first, second]);
  expect(client.getQueryData<ChannelState>(detailKey)?.messages).toEqual([updated, message]);
});

test("revealing an older message loads consecutive pages through its sequence", async () => {
  const client = createQueryClient();
  client.setQueryData(detailKey, snapshot);
  const target = { ...older, id: "target", sequence: 99 };
  const reads = mockHistory()
    .mockResolvedValueOnce({ revision: 101, messages: [older] })
    .mockResolvedValueOnce({ revision: 101, messages: [target] });
  await loadChannelHistory(client, channel.id, target.sequence);
  expect(client.getQueryData<ChannelState>(detailKey)?.messages).toEqual([target, older, message]);
  expect(reads.mock.calls.map(([before]) => before)).toEqual([101, 100]);
});

test("history completion cannot recreate a deleted Channel", async () => {
  const client = createQueryClient();
  client.setQueryData(detailKey, snapshot);
  const held = Promise.withResolvers<Pick<ChannelState, "revision" | "messages">>();
  mockHistory().mockReturnValue(held.promise);
  const pending = loadChannelHistory(client, channel.id);
  cache.applyEvent(client, { type: "channel.deleted", channelId: channel.id });
  held.resolve({ revision: 101, messages: [older] });
  await pending;
  expect(client.getQueryData(detailKey)).toBeUndefined();
});

test("a request jump survives repeated overtaken pages without advancing the stream cursor", async () => {
  const client = createQueryClient();
  client.setQueryData(detailKey, snapshot);
  let revision = snapshot.revision;
  let reads = 0;
  const reader = mockHistory().mockImplementation(async () => {
    const pageRevision = revision;
    if (++reads <= 3)
      client.setQueryData<ChannelQueryData>(detailKey, {
        ...snapshot,
        revision: ++revision,
      });
    return { revision: pageRevision, messages: [older] };
  });
  await loadChannelHistory(client, channel.id, older.sequence);
  expect(client.getQueryData(detailKey)?.messages).toEqual([older, message]);
  expect(reads).toBe(4);

  client.setQueryData(detailKey, snapshot);
  reader.mockResolvedValue({ revision: 105, messages: [older] });
  await loadChannelHistory(client, channel.id);
  expect(client.getQueryData(detailKey)).toMatchObject({
    revision: 101,
    messages: [older, message],
  });
});

test("create and edit responses invalidate instead of overwriting newer catalog state", async () => {
  const client = createQueryClient();
  const key = channelQueries.list.queryKey;
  const deleted: ChannelList = { channels: [], members: [] };
  client.setQueryData(key, deleted);

  await channelMutations.create().onSuccess!(
    channel,
    { name: channel.name, model: channel.model },
    undefined,
    { client, meta: undefined },
  );
  expect(client.getQueryData<ChannelList>(key)).toEqual(deleted);
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);

  const current: ChannelList = {
    channels: [{ ...channel, preview: { kind: "url", url: "https://current.example" } }],
    members: [],
  };
  client.setQueryData(key, current);
  await channelMutations.edit().onSuccess!(
    channel,
    { channelId: channel.id, name: channel.name },
    undefined,
    { client, meta: undefined },
  );
  expect(client.getQueryData<ChannelList>(key)).toEqual(current);
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});

test("deleting a channel removes it and its unsent draft right away", async () => {
  const client = createQueryClient();
  const draft = { text: "Half-written idea", origin: "client", updatedAt: 1 };
  client.setQueryData(channelQueries.list.queryKey, { channels: [channel], members: [] });
  client.setQueryData(workspaceQueries.state.queryKey, {
    ...createEmptyWorkspaceState(),
    drafts: { [`channel:${channel.id}`]: draft },
  });

  await channelMutations.delete(channel.id).onSuccess!(true, undefined, undefined, {
    client,
    meta: undefined,
  });

  expect(client.getQueryData(channelQueries.list.queryKey)?.channels).toEqual([]);
  expect(client.getQueryData(workspaceQueries.state.queryKey)?.drafts).toEqual({});
});

test("a failed post removes its local copy, unless the echo already replaced it", async () => {
  const client = createQueryClient();
  client.setQueryData(detailKey, snapshot);
  const post = channelMutations.post();
  const input = { channelId: channel.id, id: "sent", content: "Sent" };
  const context = { client, meta: undefined };

  const failed = await post.onMutate!(input, context);
  await post.onError!(new Error("Offline"), input, failed, context);
  expect(client.getQueryData(detailKey)).toEqual(snapshot);

  const committed = await post.onMutate!(input, context);
  const echo = { ...committed!, timestamp: message.timestamp };
  client.setQueryData<ChannelQueryData>(
    detailKey,
    (state) => state && { ...state, messages: [...state.messages.slice(0, -1), echo] },
  );
  await post.onError!(new Error("Response lost"), input, committed, context);
  expect(client.getQueryData<ChannelQueryData>(detailKey)?.messages.map(({ id }) => id)).toEqual([
    "latest",
    "sent",
  ]);
});

function mockHistory() {
  const read = mock<(before: number) => Promise<Pick<ChannelState, "revision" | "messages">>>();
  const options = channelQueries.messagesBefore;
  const query = spyOn(channelQueries, "messagesBefore").mockImplementation((id, before) => ({
    ...options(id, before),
    queryFn: () => read(before),
  }));
  onTestFinished(() => query.mockRestore());
  return read;
}

function createQueryClient(): QueryClient {
  const client = new QueryClient();
  onTestFinished(() => client.clear());
  return client;
}
