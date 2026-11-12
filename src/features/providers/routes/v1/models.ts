import { createFileRoute } from "@tanstack/react-router";
import { getModelChoices } from "@providers/server";
import { respond } from "@/shared/server/http";

export const Route = createFileRoute("/api/v1/models")({
  server: {
    handlers: {
      GET: () => respond("list models", () => getModelChoices()),
    },
  },
});
