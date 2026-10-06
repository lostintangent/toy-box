import { createFileRoute } from "@tanstack/react-router";
import { getChannelHistoryResponse, postChannelMessageResponse } from "@channels/server/api";

export const Route = createFileRoute("/api/v1/channels/$channelId/messages")({
  server: {
    handlers: {
      GET: ({ params, request }) => getChannelHistoryResponse(params.channelId, request),
      POST: ({ params, request }) => postChannelMessageResponse(params.channelId, request),
    },
  },
});
