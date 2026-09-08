import { createFileRoute } from "@tanstack/react-router";
import { streamChannel } from "@channels/server";
import { createSseResponse } from "@/shared/server/sse";

export const Route = createFileRoute("/api/channels/$channelId")({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        createSseResponse(request, (send) =>
          streamChannel(params.channelId, readCursor(request), (event) =>
            send(event, event.cursor),
          ),
        ),
    },
  },
});

function readCursor(request: Request): number {
  const value =
    request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after");
  const cursor = Number(value);
  return Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
}
