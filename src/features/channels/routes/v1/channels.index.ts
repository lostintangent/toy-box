import { createFileRoute } from "@tanstack/react-router";
import { listChannels } from "@channels/server";

export const Route = createFileRoute("/api/v1/channels/")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          { version: 1, ...(await listChannels()) },
          { headers: { "Cache-Control": "no-store" } },
        ),
    },
  },
});
