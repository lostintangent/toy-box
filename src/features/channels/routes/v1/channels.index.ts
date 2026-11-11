import { createFileRoute } from "@tanstack/react-router";
import { createChannelInputSchema } from "@channels/model";
import { createChannel } from "@channels/server";
import { readInput, respond } from "@channels/server/http";
import { getChannelCatalog, subscribeToChannelCatalog } from "@channels/server/stream";
import { createSseResponse } from "@/shared/server/sse";

export const Route = createFileRoute("/api/v1/channels/")({
  server: {
    handlers: {
      /** One URL serves the catalog as JSON, or as a stream that opens with the same JSON when asked. */
      GET: async ({ request }) => {
        const response = request.headers.get("accept")?.includes("text/event-stream")
          ? createSseResponse(request, subscribeToChannelCatalog)
          : Response.json(await getChannelCatalog(), { headers: { "Cache-Control": "no-store" } });
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
