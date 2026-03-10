import { createFileRoute } from "@tanstack/react-router";
import type { ServerUpdateEvent } from "@/types";

const encoder = new TextEncoder();

const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_CHUNK = encoder.encode(": keepalive\n\n");
const RETRY_CHUNK = encoder.encode("retry: 1000\n\n");

function encodeServerUpdateEvent(event: ServerUpdateEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function createServerEventsResponse(request: Request): Response {
  let dispose = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const { subscribeSessionsUpdates } = await import("@/functions/runtime/broadcast");
      const { subscribeAutomationsUpdates } = await import("@/functions/automations/events");

      let closed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      let unsubscribeSessions = () => {};
      let unsubscribeAutomations = () => {};

      const close = (closeController: boolean) => {
        if (closed) return;
        closed = true;

        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
        }

        unsubscribeSessions();
        unsubscribeAutomations();

        request.signal.removeEventListener("abort", onAbort);

        if (closeController) {
          try {
            controller.close();
          } catch {
            // Ignore close races when the stream is already closed.
          }
        }
      };

      const onAbort = () => {
        close(true);
      };

      const sendEvent = (event: ServerUpdateEvent) => {
        if (closed) return;
        controller.enqueue(encodeServerUpdateEvent(event));
      };

      request.signal.addEventListener("abort", onAbort, { once: true });

      controller.enqueue(RETRY_CHUNK);

      unsubscribeSessions = subscribeSessionsUpdates((event) => sendEvent(event));
      unsubscribeAutomations = subscribeAutomationsUpdates((event) => sendEvent(event));

      heartbeatTimer = setInterval(() => {
        if (closed) return;
        controller.enqueue(HEARTBEAT_CHUNK);
      }, HEARTBEAT_INTERVAL_MS);

      dispose = () => close(false);
    },
    cancel() {
      dispose();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const Route = createFileRoute("/api/events")({
  server: {
    handlers: {
      GET: ({ request }) => createServerEventsResponse(request),
    },
  },
});
