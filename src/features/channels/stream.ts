import { readEventStream } from "@/shared/sse";
import type { ChannelObservationEvent } from "./model";

/** One observation attempt. Query retries from its current cached revision. */
export async function* streamChannel(
  channelId: string,
  signal: AbortSignal,
  after?: number,
): AsyncGenerator<ChannelObservationEvent> {
  const url = `/api/v1/channels/${encodeURIComponent(channelId)}`;
  for await (const event of readEventStream<ChannelObservationEvent>(
    after === undefined ? url : `${url}?after=${after}`,
    signal,
  )) {
    yield event;
    if (event.type === "deleted") return;
  }
  throw new Error("The Channel connection ended before deletion.");
}
