import { createFileRoute } from "@tanstack/react-router";
import { createChannelResponse, getChannelsResponse } from "@channels/server/api";

export const Route = createFileRoute("/api/v1/channels/")({
  server: {
    handlers: {
      GET: ({ request }) => getChannelsResponse(request),
      POST: ({ request }) => createChannelResponse(request),
    },
  },
});
