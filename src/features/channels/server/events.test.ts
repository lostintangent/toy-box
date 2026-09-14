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
    sessionId: `session-${revision}`,
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
