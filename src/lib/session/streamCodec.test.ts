import { describe, expect, test } from "bun:test";
import { consumeSessionEvents, decodeSessionEvents, encodeSessionEvent } from "./streamCodec";
import type { SessionEvent } from "@/types";

async function collectEvents(stream: ReadableStream<Uint8Array>): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  for await (const event of decodeSessionEvents(stream)) events.push(event);
  return events;
}

describe("session stream codec", () => {
  test("decodes events split across transport chunks", async () => {
    const event: SessionEvent = { type: "end", reason: "idle" };
    const encoded = encodeSessionEvent(event);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 5));
        controller.enqueue(encoded.slice(5));
        controller.close();
      },
    });

    expect(await collectEvents(stream)).toEqual([event]);
  });

  test("decodes multiple UTF-8 events split at byte boundaries and a final line without newline", async () => {
    const events: SessionEvent[] = [
      { type: "delta", content: "café ☕" },
      { type: "end", reason: "idle" },
    ];
    const first = encodeSessionEvent(events[0]);
    const trailing = new TextEncoder().encode(JSON.stringify(events[1]));
    const bytes = new Uint8Array(first.length + 1 + trailing.length);
    bytes.set(first);
    bytes[first.length] = 10;
    bytes.set(trailing, first.length + 1);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });

    expect(await collectEvents(stream)).toEqual(events);
  });

  test("consumes decoded events and announces the first one once", async () => {
    const events: SessionEvent[] = [
      { type: "delta", content: "Hello" },
      { type: "end", reason: "idle" },
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(encodeSessionEvent(event));
        controller.close();
      },
    });
    const consumed: SessionEvent[] = [];
    let firstEventCount = 0;

    const receivedEvent = await consumeSessionEvents(stream, {
      signal: new AbortController().signal,
      onEvent: (event) => consumed.push(event),
      onFirstEvent: () => firstEventCount++,
    });

    expect(receivedEvent).toBe(true);
    expect(consumed).toEqual(events);
    expect(firstEventCount).toBe(1);
  });

  test("stops delivering events when the subscriber aborts", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(encodeSessionEvent({ type: "delta", content: "first" }));
        streamController.enqueue(encodeSessionEvent({ type: "delta", content: "second" }));
        streamController.close();
      },
    });
    const consumed: SessionEvent[] = [];

    const receivedEvent = await consumeSessionEvents(stream, {
      signal: controller.signal,
      onEvent: (event) => {
        consumed.push(event);
        controller.abort();
      },
    });

    expect(receivedEvent).toBe(true);
    expect(consumed).toEqual([{ type: "delta", content: "first" }]);
  });
});
