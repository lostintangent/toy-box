import { createFileRoute } from "@tanstack/react-router";
import { deleteChannelRoutine } from "@channels/server";
import { noContent, notFound, respond } from "@channels/server/http";

export const Route = createFileRoute("/api/v1/channels/$channelId/routines/$routineId")({
  server: {
    handlers: {
      DELETE: ({ params: { channelId, routineId } }) =>
        respond(`delete routine ${routineId}`, async () =>
          (await deleteChannelRoutine(channelId, routineId)) ? noContent() : notFound("Routine"),
        ),
    },
  },
});
