import { expect, test } from "bun:test";
import { channelStatus, type Channel } from "@channels/model";
import { channelSidebarStatus } from "./status";

const channel: Channel = {
  id: "channel",
  name: "Planning",
  model: { provider: "copilot", name: "default" },
  tasks: [],
  latestSequence: 2,
  seenThrough: 1,
  requestSequence: null,
  completedSequence: null,
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
  "status priority and visibility: request=$request done=$done open=$open",
  ({ request, done, open, expected }) => {
    const current = {
      ...channel,
      requestSequence: request ? 2 : null,
      completedSequence: done ? 2 : null,
    };
    expect(channelSidebarStatus(current, channelStatus(current), open)?.kind).toBe(expected);
  },
);

test("a read channel needs no status badge", () => {
  const current = { ...channel, seenThrough: channel.latestSequence };
  expect(channelSidebarStatus(current, channelStatus(current), false)).toBeUndefined();
});
