import { createFileRoute } from "@tanstack/react-router";
import { markChannelReadInputSchema } from "@channels/model";
import { markChannelRead } from "@channels/server";
import { notFound, readInput, respond } from "@channels/server/http";

export const Route = createFileRoute("/api/v1/channels/$channelId/read")({
  server: {
    handlers: {
      POST: ({ params, request }) =>
        respond("mark Channel read", async () => {
          const input = await readInput(request, markChannelReadInputSchema, params);
          const channel = await markChannelRead(input.channelId, input.sequence);
          return channel
            ? Response.json({ seenThrough: channel.seenThrough })
            : notFound("Channel");
        }),
    },
  },
});
