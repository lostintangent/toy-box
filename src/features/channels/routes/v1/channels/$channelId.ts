import { createFileRoute } from "@tanstack/react-router";
import { editChannelInputSchema } from "@channels/model";
import { deleteChannel, editChannel } from "@channels/server";
import { noContent, notFound, readInput, respond } from "@channels/server/http";
import { streamChannel } from "@channels/server/stream";
import { createSseResponse } from "@/shared/server/sse";

export const Route = createFileRoute("/api/v1/channels/$channelId")({
  server: {
    handlers: {
      GET: ({ params, request }) => {
        // A blank or invalid cursor opens with a snapshot rather than resuming.
        const after = Number(new URL(request.url).searchParams.get("after")?.trim() || NaN);
        const revision = Number.isSafeInteger(after) && after >= 0 ? after : undefined;
        return createSseResponse(request, (send, close) =>
          streamChannel(params.channelId, send, close, revision),
        );
      },
      PATCH: ({ params, request }) =>
        respond(`edit Channel ${params.channelId}`, async () => {
          const input = await readInput(request, editChannelInputSchema, params);
          return Response.json(await editChannel(input));
        }),
      DELETE: ({ params }) =>
        respond(`delete Channel ${params.channelId}`, async () =>
          (await deleteChannel(params.channelId)) ? noContent() : notFound("Channel"),
        ),
    },
  },
});
