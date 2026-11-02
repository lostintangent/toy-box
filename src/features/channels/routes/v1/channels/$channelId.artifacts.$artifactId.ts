import { createFileRoute } from "@tanstack/react-router";
import { removeChannelArtifactResponse } from "@channels/server/api";

export const Route = createFileRoute("/api/v1/channels/$channelId/artifacts/$artifactId")({
  server: {
    handlers: {
      DELETE: ({ params }) => removeChannelArtifactResponse(params.channelId, params.artifactId),
    },
  },
});
