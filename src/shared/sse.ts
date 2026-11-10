import { EventSourceParserStream } from "eventsource-parser/stream";

/** The server refused to open an event stream. */
export class EventStreamError extends Error {
  constructor(readonly status: number) {
    super(`Unable to connect (HTTP ${status}).`);
  }
}

/** One attempt to read a server-sent event stream, yielding each JSON event until the body ends. */
export async function* readEventStream<T>(url: string, signal: AbortSignal): AsyncGenerator<T> {
  const response = await fetch(url, { signal, headers: { Accept: "text/event-stream" } });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new EventStreamError(response.status);
  }

  const reader = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      yield JSON.parse(value.data) as T;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
