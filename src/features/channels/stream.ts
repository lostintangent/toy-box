import { readEventStream } from "@/shared/sse";
import type { ChannelSubscriptionEvent } from "./model";

/** One subscription attempt. Query retries from its current cached revision. */
export async function* streamChannel(
  channelId: string,
  signal: AbortSignal,
  after?: number,
): AsyncGenerator<ChannelSubscriptionEvent> {
  const url = `/api/v1/channels/${encodeURIComponent(channelId)}`;
  for await (const event of readEventStream<ChannelSubscriptionEvent>(
    after === undefined ? url : `${url}?after=${after}`,
    signal,
  )) {
    yield event;
    if (event.type === "deleted") return;
  }
  throw new Error("The Channel connection ended before deletion.");
}
