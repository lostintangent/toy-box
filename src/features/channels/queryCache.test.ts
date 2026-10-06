import { expect, mock, onTestFinished, spyOn, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { channelLead, type Channel, type ChannelList } from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { channelQueries, type ChannelQueryData } from "@channels/queries";
import { applyChannelListEvent, loadChannelHistory } from "./queryCache";
import type { ChannelConversationMessage, ChannelState } from "./model";

const channel: Channel = {
  id: "channel",
  name: "Planning",
  purpose: "Prepare the release plan.",
  model: { provider: "copilot", name: "gpt-5.5" },
  tasks: [],
  latestSequence: 0,
  seenThrough: 0,
  completedSequence: null,
  requestSequence: null,
  updatedAt: "2026-09-05T12:00:00.000Z",
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
  channel: { ...channel, latestSequence: message.sequence },
  request: null,
  presence: {},
  revision: 101,
  lead: channelLead(channel.id),
  members: [],
  messages: [message],
  artifacts: [],
  routines: [],
};
const detailKey = channelQueries.detail(channel.id).queryKey;

test("live events do not replace initial catalog loading with a partial list", () => {
  const client = createQueryClient();
  applyChannelListEvent(client, { type: "channel.upserted", channel });
  expect(client.getQueryData(channelQueries.listKey())).toBeUndefined();
});

test("catalog membership follows workspace events without touching detail state", () => {
  const client = createQueryClient();
  const key = channelQueries.listKey();
  client.setQueryData(key, { channels: [channel], members: [] });
  client.setQueryData(detailKey, snapshot);
  const member = { id: "reviewer", channelId: channel.id, name: "Reviewer" };
  applyChannelListEvent(client, { type: "channel.member.upserted", member });
  applyChannelListEvent(client, {
    type: "channel.member.upserted",
    member: { ...member, name: "Ada" },
  });
  expect(client.getQueryData<ChannelList>(key)?.members).toEqual([{ ...member, name: "Ada" }]);
  applyChannelListEvent(client, {
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
  applyChannelListEvent(client, { type: "channel.deleted", channelId: channel.id });
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

test.each(["channel.upserted", "channel.deleted"] as const)(
  "%s replaces an in-flight catalog read without resurrecting old state",
  async (type) => {
    const client = createQueryClient();
    const held = Promise.withResolvers<ChannelList>();
    const updated = { ...channel, name: "Updated planning" };
    const other = { ...channel, id: "other" };
    const member = { channelId: channel.id, id: "reviewer", name: "Reviewer" };
    const otherMember = { channelId: other.id, id: "builder", name: "Builder" };
    const latest = {
      channels: type === "channel.upserted" ? [updated, other] : [other],
      members: type === "channel.upserted" ? [member, otherMember] : [otherMember],
    };
    const stale = { channels: [channel, other], members: [member, otherMember] };
    client.setQueryData<ChannelList>(channelQueries.listKey(), stale);
    let reads = 0;
    const pending = client.query({
      ...channelQueries.list(),
      staleTime: 0,
      queryFn: () => (++reads === 1 ? held.promise : Promise.resolve(latest)),
    });
    applyChannelListEvent(
      client,
      type === "channel.upserted" ? { type, channel: updated } : { type, channelId: channel.id },
    );
    expect(client.getQueryData<ChannelList>(channelQueries.listKey())).toEqual(latest);
    held.resolve(stale);
    await pending;
    expect(client.getQueryData<ChannelList>(channelQueries.listKey())).toEqual(latest);
  },
);

test("create and edit responses invalidate instead of overwriting newer catalog state", async () => {
  const client = createQueryClient();
  const key = channelQueries.listKey();
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

  const current = {
    channels: [{ ...channel, previewUrl: "https://current.example" }],
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
