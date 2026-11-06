import { createFileRoute } from "@tanstack/react-router";
import { bookmarkChannelMessageResponse } from "@channels/server/api";

export const Route = createFileRoute("/api/v1/channels/$channelId/bookmarks/$sequence")({
  server: {
    handlers: {
      PUT: ({ params }) => bookmarkChannelMessageResponse(params.channelId, params.sequence, true),
      DELETE: ({ params }) =>
        bookmarkChannelMessageResponse(params.channelId, params.sequence, false),
    },
  },
});
