import { createFileRoute } from "@tanstack/react-router";
import { streamChannel } from "@channels/server";
import { createSseResponse } from "@/shared/server/sse";

export const Route = createFileRoute("/api/channels/$channelId")({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        createSseResponse(request, (send) =>
          streamChannel(params.channelId, readAfterRevision(request), (event) =>
            send(event, event.revision),
          ),
        ),
    },
  },
});

function readAfterRevision(request: Request): number {
  const value =
    request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after");
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
}
