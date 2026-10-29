import { createFileRoute } from "@tanstack/react-router";
import { subscribeResponse, removeResponse } from "@push/server/api";

export const Route = createFileRoute("/api/v1/push/$registrationID/topics/$topic")({
  server: {
    handlers: {
      PUT: ({ params, request }) => subscribeResponse(params.registrationID, params.topic, request),
      DELETE: ({ params }) => removeResponse(params.registrationID, params.topic),
    },
  },
});
