import { createFileRoute } from "@tanstack/react-router";
import { runChannelRoutine } from "@channels/server";
import { NotFoundError, respond } from "@/shared/server/http";

export const Route = createFileRoute("/api/v1/channels/$channelId/routines/$routineId/run")({
  server: {
    handlers: {
      POST: ({ params: { channelId, routineId } }) =>
        respond(`run routine ${routineId}`, async () => {
          if (!(await runChannelRoutine(channelId, routineId))) throw new NotFoundError("Routine");
        }),
    },
  },
});
