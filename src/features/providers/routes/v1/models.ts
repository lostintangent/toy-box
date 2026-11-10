import { createFileRoute } from "@tanstack/react-router";
import { getModelChoices } from "@providers/server";

export const Route = createFileRoute("/api/v1/models")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(await getModelChoices(), { headers: { "Cache-Control": "no-store" } }),
    },
  },
});
