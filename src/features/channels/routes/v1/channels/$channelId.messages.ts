import { createFileRoute } from "@tanstack/react-router";
import { postChannelMessageInputSchema } from "@channels/model";
import { getChannelHistory, postChannelMessage } from "@channels/server";
import { invalidRequest, NotFoundError, readInput, respond } from "@/shared/server/http";

export const Route = createFileRoute("/api/v1/channels/$channelId/messages")({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        respond("page Channel messages", async () => {
          const before = Number(new URL(request.url).searchParams.get("before"));
          if (!Number.isSafeInteger(before) || before <= 0) throw invalidRequest();
          const page = await getChannelHistory(params.channelId, before);
          if (!page) throw new NotFoundError("Channel");
          return page;
        }),
      POST: ({ params, request }) =>
        respond("post Channel message", async () => {
          const input = await readInput(request, postChannelMessageInputSchema, params);
          return Response.json(await postChannelMessage(input, { type: "user" }), { status: 201 });
        }),
    },
  },
});
