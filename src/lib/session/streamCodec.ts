// NDJSON codec for SessionEvent streams over HTTP.
//
// The encoder serialises individual events for the server's streaming
// response; the decoder reassembles them on the client from chunked
// ReadableStream data, handling partial lines across chunk boundaries.

import type { SessionEvent } from "@/types";

const encoder = new TextEncoder();

export function encodeSessionEvent(event: SessionEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

export async function* decodeSessionEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SessionEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line.length > 0) {
          yield JSON.parse(line) as SessionEvent;
        }

        newlineIndex = buffer.indexOf("\n");
      }

      if (done) {
        break;
      }
    }

    buffer += decoder.decode();
    const trailing = buffer.trim();
    if (trailing.length > 0) {
      yield JSON.parse(trailing) as SessionEvent;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Consume decoded events until the stream ends or this subscriber aborts.
 *  Returns whether at least one event reached the consumer. */
export async function consumeSessionEvents(
  stream: ReadableStream<Uint8Array>,
  {
    signal,
    onEvent,
    onFirstEvent,
  }: {
    signal: AbortSignal;
    onEvent: (event: SessionEvent) => void;
    onFirstEvent?: () => void;
  },
): Promise<boolean> {
  let receivedEvent = false;

  for await (const event of decodeSessionEvents(stream)) {
    if (signal.aborted) break;
    if (!receivedEvent) {
      receivedEvent = true;
      onFirstEvent?.();
    }
    onEvent(event);
  }

  return receivedEvent;
}
