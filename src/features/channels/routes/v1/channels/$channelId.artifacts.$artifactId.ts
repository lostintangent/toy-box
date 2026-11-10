import { createFileRoute } from "@tanstack/react-router";
import { removeChannelArtifact } from "@channels/server";
import { noContent, notFound, respond } from "@channels/server/http";

export const Route = createFileRoute("/api/v1/channels/$channelId/artifacts/$artifactId")({
  server: {
    handlers: {
      DELETE: ({ params: { channelId, artifactId } }) =>
        respond(`remove artifact ${artifactId}`, async () =>
          (await removeChannelArtifact(channelId, artifactId, { type: "user" }))
            ? noContent()
            : notFound("Artifact"),
        ),
    },
  },
});
