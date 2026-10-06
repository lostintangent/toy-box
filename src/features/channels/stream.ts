import { EventSourceParserStream } from "eventsource-parser/stream";
import type { ChannelObservationEvent } from "./model";

export class ChannelStreamError extends Error {
  constructor(readonly status: number) {
    super(`Unable to connect to the Channel (HTTP ${status}).`);
  }
}

/** One observation attempt. Query retries from its current cached revision. */
export async function* streamChannel(
  channelId: string,
  signal: AbortSignal,
  after?: number,
): AsyncGenerator<ChannelObservationEvent> {
  const url = `/api/v1/channels/${encodeURIComponent(channelId)}`;
  const response = await fetch(after === undefined ? url : `${url}?after=${after}`, {
    signal,
    headers: { Accept: "text/event-stream" },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ChannelStreamError(response.status);
  }
  if (!response.body) throw new Error("The Channel stream has no response body.");

  const events = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream());
  const reader = events.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("The Channel connection ended before deletion.");
      const event = JSON.parse(value.data) as ChannelObservationEvent;
      yield event;
      if (event.type === "deleted") return;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
