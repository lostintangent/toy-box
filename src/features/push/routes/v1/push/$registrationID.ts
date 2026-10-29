import { createFileRoute } from "@tanstack/react-router";
import { removeResponse, registerResponse } from "@push/server/api";

export const Route = createFileRoute("/api/v1/push/$registrationID")({
  server: {
    handlers: {
      PUT: ({ params, request }) => registerResponse(params.registrationID, request),
      DELETE: ({ params }) => removeResponse(params.registrationID),
    },
  },
});
