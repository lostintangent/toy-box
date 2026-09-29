import { expect, test } from "bun:test";
import type { Channel } from "@channels/model";
import { channelAttention } from "./attention";

const channel: Channel = {
  id: "channel",
  name: "Planning",
  model: { provider: "copilot", name: "default" },
  checklist: [],
  latestSequence: 2,
  seenThrough: 1,
  hasPendingRequest: false,
  hasUnreadCompletion: false,
  updatedAt: new Date(0).toISOString(),
};

test.each([
  { request: true, done: true, open: false, expected: "waiting" },
  { request: true, done: true, open: true, expected: "waiting" },
  { request: false, done: true, open: false, expected: "finished" },
  { request: false, done: true, open: true, expected: undefined },
  { request: false, done: false, open: false, expected: "unread" },
  { request: false, done: false, open: true, expected: undefined },
])(
  "attention priority: request=$request done=$done open=$open",
  ({ request, done, open, expected }) => {
    expect(
      channelAttention({ ...channel, hasPendingRequest: request, hasUnreadCompletion: done }, open)
        ?.kind,
    ).toBe(expected);
  },
);

test("a read channel needs no attention", () => {
  expect(
    channelAttention({ ...channel, seenThrough: channel.latestSequence }, false),
  ).toBeUndefined();
});
