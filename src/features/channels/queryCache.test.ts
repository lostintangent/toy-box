import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { channelHasUnread, type Channel } from "@channels/model";
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
  queryClient.setQueryData(channelQueries.listKey(), [channel]);

  const unreadEvent = {
    type: "channel.upserted",
    channel: { ...channel, latestSequence: 1 },
  } as const;
  applyChannelListEvent(queryClient, unreadEvent);
  applyChannelListEvent(queryClient, unreadEvent);
  expect(queryClient.getQueryData<Channel[]>(channelQueries.listKey())).toHaveLength(1);
  expect(channelHasUnread(queryClient.getQueryData<Channel[]>(channelQueries.listKey())![0]!)).toBe(
    true,
  );

  applyChannelListEvent(queryClient, {
    type: "channel.upserted",
    channel: { ...channel, latestSequence: 1, seenThrough: 1 },
  });
  expect(channelHasUnread(queryClient.getQueryData<Channel[]>(channelQueries.listKey())![0]!)).toBe(
    false,
  );
});
