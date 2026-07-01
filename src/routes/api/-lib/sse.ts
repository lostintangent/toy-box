type SseStart<T> = (
  send: (event: T) => void,
  close: () => void,
) => void | VoidFunction | Promise<void | VoidFunction>;

const encoder = new TextEncoder();
const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_CHUNK = encoder.encode(": keepalive\n\n");
const RETRY_CHUNK = encoder.encode("retry: 1000\n\n");

export function createSseResponse<T>(request: Request, start: SseStart<T>): Response {
  let dispose = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let cleanup: VoidFunction = () => {};
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

      const close = (closeController: boolean) => {
        if (closed) return;
        closed = true;

        cleanup();
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        request.signal.removeEventListener("abort", onAbort);

        if (closeController) {
          try {
            controller.close();
          } catch {
            // Ignore close races when the stream is already closed.
          }
        }
      };

      const onAbort = () => close(true);
      const send = (event: T) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // Install cancellation before route setup runs; setup may await imports or
      // resources, and the client can disconnect during that window.
      dispose = () => close(false);
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted) {
        close(true);
        return;
      }

      controller.enqueue(RETRY_CHUNK);

      let maybeCleanup: void | VoidFunction;
      try {
        maybeCleanup = await start(send, () => close(true));
      } catch (error) {
        if (!closed) {
          close(false);
          controller.error(error);
        }
        return;
      }

      cleanup = typeof maybeCleanup === "function" ? maybeCleanup : () => {};
      if (closed) {
        // If cancellation happened while setup was awaiting, run the route
        // cleanup immediately because close() could not see it yet.
        cleanup();
        return;
      }

      heartbeatTimer = setInterval(() => {
        if (closed) return;
        controller.enqueue(HEARTBEAT_CHUNK);
      }, HEARTBEAT_INTERVAL_MS);
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
