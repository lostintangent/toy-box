import { createFileRoute } from "@tanstack/react-router";
import { markChannelReadResponse } from "@channels/server/api";

export const Route = createFileRoute("/api/v1/channels/$channelId/read")({
  server: {
    handlers: {
      POST: ({ params, request }) => markChannelReadResponse(params.channelId, request),
    },
  },
});
