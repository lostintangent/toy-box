import { expect, onTestFinished, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { channelHasUnread, channelLead, type Channel, type ChannelList } from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { channelQueries } from "@channels/queries";
import { applyChannelListEvent } from "./queryCache";

const channel: Channel = {
  id: "channel",
  name: "Planning",
  purpose: "Prepare the release plan.",
  model: { provider: "copilot", name: "gpt-5.5" },
  checklist: [],
  latestSequence: 0,
  seenThrough: 0,
  hasUnreadCompletion: false,
  hasPendingRequest: false,
  updatedAt: "2026-09-05T12:00:00.000Z",
};

test("live events do not replace initial catalog loading with a partial list", () => {
  const client = createQueryClient();
  applyChannelListEvent(client, { type: "channel.upserted", channel });
  expect(client.getQueryData(channelQueries.listKey())).toBeUndefined();
});

test.each(["channel.upserted", "channel.deleted"] as const)(
  "%s replaces an in-flight catalog read without resurrecting old state",
  async (type) => {
    const client = createQueryClient();
    const snapshot = Promise.withResolvers<ChannelList>();
    const waiting = {
      ...channel,
      latestSequence: 3,
      hasPendingRequest: true,
      hasUnreadCompletion: true,
    };
    const acknowledged = {
      ...channel,
      latestSequence: 4,
      seenThrough: 4,
    };
    const other = { ...channel, id: "other" };
    const member = { channelId: channel.id, id: "reviewer", name: "Reviewer" };
    const otherMember = { channelId: other.id, id: "builder", name: "Builder" };
    const latest = {
      channels: type === "channel.upserted" ? [acknowledged, other] : [other],
      members: type === "channel.upserted" ? [member, otherMember] : [otherMember],
    };
    const stale = { channels: [waiting, other], members: [member, otherMember] };
    client.setQueryData<ChannelList>(channelQueries.listKey(), stale);
    const detailKey = channelQueries.detail(channel.id).queryKey;
    client.setQueryData(detailKey, {
      revision: 0,
      lead: channelLead(channel.id),
      members: [member],
      messages: [],
      artifacts: [],
    });
    let reads = 0;
    const pending = client.query({
      ...channelQueries.list(),
      staleTime: 0,
      queryFn: () => (++reads === 1 ? snapshot.promise : Promise.resolve(latest)),
    });
    applyChannelListEvent(
      client,
      type === "channel.upserted"
        ? { type, channel: acknowledged }
        : { type, channelId: channel.id },
    );
    if (type === "channel.deleted") {
      expect(client.getQueryData<ChannelList>(channelQueries.listKey())).toEqual(latest);
      expect(client.getQueryData(detailKey)).toBeUndefined();
    }
    snapshot.resolve(stale);
    await expect(pending).resolves.toEqual(latest);
    expect(reads).toBe(2);
    expect(client.getQueryData<ChannelList>(channelQueries.listKey())).toEqual(latest);
  },
);

test("create and edit responses invalidate instead of overwriting newer catalog state", async () => {
  const client = createQueryClient();
  const key = channelQueries.listKey();
  const deleted: ChannelList = { channels: [], members: [] };
  client.setQueryData(key, deleted);

  await new MutationObserver(client, {
    ...channelMutations.create(),
    mutationFn: async () => channel,
  }).mutate({ name: channel.name, model: channel.model });
  expect(client.getQueryData<ChannelList>(key)).toEqual(deleted);
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);

  const current = {
    channels: [{ ...channel, previewUrl: "https://current.example" }],
    members: [],
  };
  client.setQueryData(key, current);
  await new MutationObserver(client, {
    ...channelMutations.edit(),
    mutationFn: async () => channel,
  }).mutate({ channelId: channel.id, name: channel.name });
  expect(client.getQueryData<ChannelList>(key)).toEqual(current);
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});

test("Channel list events are idempotent and project unread state for unopened Channels", () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData<ChannelList>(channelQueries.listKey(), {
    channels: [channel],
    members: [],
  });
  const unreadEvent = {
    type: "channel.upserted",
    channel: { ...channel, latestSequence: 1 },
  } as const;
  applyChannelListEvent(queryClient, unreadEvent);
  applyChannelListEvent(queryClient, unreadEvent);
  expect(queryClient.getQueryData<ChannelList>(channelQueries.listKey())?.channels).toHaveLength(1);
  expect(
    channelHasUnread(queryClient.getQueryData<ChannelList>(channelQueries.listKey())!.channels[0]!),
  ).toBe(true);

  applyChannelListEvent(queryClient, {
    type: "channel.upserted",
    channel: { ...channel, latestSequence: 1, seenThrough: 1 },
  });
  expect(
    channelHasUnread(queryClient.getQueryData<ChannelList>(channelQueries.listKey())!.channels[0]!),
  ).toBe(false);
});

test("Channel membership changes refresh the list projection", () => {
  const queryClient = createQueryClient();
  queryClient.setQueryData<ChannelList>(channelQueries.listKey(), {
    channels: [],
    members: [],
  });

  applyChannelListEvent(queryClient, {
    type: "channel.members.changed",
  });

  expect(queryClient.getQueryState(channelQueries.listKey())?.isInvalidated).toBe(true);
});

function createQueryClient(): QueryClient {
  const client = new QueryClient();
  onTestFinished(() => client.clear());
  return client;
}
