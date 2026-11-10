import { createFileRoute } from "@tanstack/react-router";
import { runChannelRoutine } from "@channels/server";
import { noContent, notFound, respond } from "@channels/server/http";

export const Route = createFileRoute("/api/v1/channels/$channelId/routines/$routineId/run")({
  server: {
    handlers: {
      POST: ({ params: { channelId, routineId } }) =>
        respond(`run routine ${routineId}`, async () =>
          (await runChannelRoutine(channelId, routineId)) ? noContent() : notFound("Routine"),
        ),
    },
  },
});
