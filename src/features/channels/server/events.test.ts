import { expect, onTestFinished, test } from "bun:test";
import type { ChannelEvent } from "@channels/model";
import {
  publishChannelEvent,
  releaseChannelEvents,
  replayChannelEvents,
  subscribeChannelEvents,
} from "./events";

function update(revision: number): ChannelEvent {
  return {
    type: "status",
    revision,
    agentId: `session-${revision}`,
    status: { state: "working", text: `Task ${revision}` },
  };
}

test("Channel events provide live delivery or a complete revision replay", () => {
  const channelId = `channel-${crypto.randomUUID()}`;
  onTestFinished(() => releaseChannelEvents(channelId));
  const received: ChannelEvent[] = [];
  const unsubscribe = subscribeChannelEvents(channelId, (event) => received.push(event));
  onTestFinished(unsubscribe);

  const first = update(1);
  const second = update(2);
  publishChannelEvent(channelId, first);
  publishChannelEvent(channelId, second);

  expect(received).toEqual([first, second]);
  expect(replayChannelEvents(channelId, 1, 2)).toEqual([second]);
  expect(replayChannelEvents(channelId, 0, 3)).toBeUndefined();
});

test("the shared replay ring orders and deduplicates publications without hiding gaps", () => {
  const channelId = crypto.randomUUID();
  onTestFinished(() => releaseChannelEvents(channelId));
  const first = update(1);
  const second = update(2);
  publishChannelEvent(channelId, second);
  publishChannelEvent(channelId, second);
  expect(replayChannelEvents(channelId, 0, 2)).toBeUndefined();
  publishChannelEvent(channelId, first);
  expect(replayChannelEvents(channelId, 0, 2)).toEqual([first, second]);
  expect(replayChannelEvents(channelId, 2, 2)).toEqual([]);
  expect(replayChannelEvents(channelId, 3, 2)).toBeUndefined();
});

test("expired cursors require a snapshot while retained history remains replayable", () => {
  const channelId = crypto.randomUUID();
  onTestFinished(() => releaseChannelEvents(channelId));
  for (let revision = 1; revision <= 501; revision++)
    publishChannelEvent(channelId, update(revision));
  expect(replayChannelEvents(channelId, 0, 501)).toBeUndefined();
  expect(replayChannelEvents(channelId, 1, 501)).toHaveLength(500);
});
