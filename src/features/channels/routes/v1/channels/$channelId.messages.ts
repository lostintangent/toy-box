import { createFileRoute } from "@tanstack/react-router";
import { postChannelMessageInputSchema } from "@channels/model";
import { getChannelHistory, postChannelMessage } from "@channels/server";
import { invalidRequest, notFound, readInput, respond } from "@channels/server/http";

export const Route = createFileRoute("/api/v1/channels/$channelId/messages")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const before = Number(new URL(request.url).searchParams.get("before"));
        if (!Number.isSafeInteger(before) || before <= 0) return invalidRequest();
        const page = await getChannelHistory(params.channelId, before);
        return page
          ? Response.json(page, { headers: { "Cache-Control": "no-store" } })
          : notFound("Channel");
      },
      POST: ({ params, request }) =>
        respond("post Channel message", async () => {
          const input = await readInput(request, postChannelMessageInputSchema, params);
          return Response.json(await postChannelMessage(input, { type: "user" }), { status: 201 });
        }),
    },
  },
});
