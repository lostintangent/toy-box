import { createFileRoute } from "@tanstack/react-router";
import { createChannelInputSchema } from "@channels/model";
import { createChannel } from "@channels/server";
import { getChannelCatalog, subscribeToChannelCatalog } from "@channels/server/stream";
import { readInput, respond } from "@/shared/server/http";
import { createSseResponse } from "@/shared/server/sse";

export const Route = createFileRoute("/api/v1/channels/")({
  server: {
    handlers: {
      /** One URL serves the catalog as JSON, or as a stream that opens with the same JSON when asked. */
      GET: async ({ request }) => {
        const response = request.headers.get("accept")?.includes("text/event-stream")
          ? createSseResponse(request, subscribeToChannelCatalog)
          : await respond("list Channels", getChannelCatalog);
        response.headers.set("Vary", "Accept");
        return response;
      },
      POST: ({ request }) =>
        respond("create a Channel", async () => {
          const input = await readInput(request, createChannelInputSchema);
          return Response.json(await createChannel(input), { status: 201 });
        }),
    },
  },
});
