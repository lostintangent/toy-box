import { createFileRoute } from "@tanstack/react-router";
import { getChannelResponse } from "@channels/server/api";

export const Route = createFileRoute("/api/v1/channels/$channelId")({
  server: {
    handlers: {
      GET: ({ params, request }) => getChannelResponse(params.channelId, request),
    },
  },
});
