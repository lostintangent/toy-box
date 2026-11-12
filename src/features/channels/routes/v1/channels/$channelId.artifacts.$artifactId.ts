import { createFileRoute } from "@tanstack/react-router";
import { removeChannelArtifact } from "@channels/server";
import { NotFoundError, respond } from "@/shared/server/http";

export const Route = createFileRoute("/api/v1/channels/$channelId/artifacts/$artifactId")({
  server: {
    handlers: {
      DELETE: ({ params: { channelId, artifactId } }) =>
        respond(`remove artifact ${artifactId}`, async () => {
          if (!(await removeChannelArtifact(channelId, artifactId, { type: "user" })))
            throw new NotFoundError("Artifact");
        }),
    },
  },
});
