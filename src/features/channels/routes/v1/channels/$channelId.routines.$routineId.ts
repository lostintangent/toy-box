import { createFileRoute } from "@tanstack/react-router";
import { deleteChannelRoutine } from "@channels/server";
import { NotFoundError, respond } from "@/shared/server/http";

export const Route = createFileRoute("/api/v1/channels/$channelId/routines/$routineId")({
  server: {
    handlers: {
      DELETE: ({ params: { channelId, routineId } }) =>
        respond(`delete routine ${routineId}`, async () => {
          if (!(await deleteChannelRoutine(channelId, routineId)))
            throw new NotFoundError("Routine");
        }),
    },
  },
});
