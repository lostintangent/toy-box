import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { channelHasUnread, type Channel, type ChannelList } from "@channels/model";
import { channelQueries } from "@channels/queries";
import { applyChannelListEvent } from "./queryCache";

test("Channel list events are idempotent and project unread state for unopened Channels", () => {
  const queryClient = new QueryClient();
  const channel: Channel = {
    id: "channel",
    title: "Planning",
    latestSequence: 0,
    seenThrough: 0,
    updatedAt: "2026-09-05T12:00:00.000Z",
  };
  queryClient.setQueryData<ChannelList>(channelQueries.listKey(), {
    channels: [channel],
    memberships: [],
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
  const queryClient = new QueryClient();
  queryClient.setQueryData<ChannelList>(channelQueries.listKey(), {
    channels: [],
    memberships: [],
  });

  applyChannelListEvent(queryClient, {
    type: "agent.membership.changed",
    host: { kind: "channel", channelId: "channel" },
  });

  expect(queryClient.getQueryState(channelQueries.listKey())?.isInvalidated).toBe(true);
});
