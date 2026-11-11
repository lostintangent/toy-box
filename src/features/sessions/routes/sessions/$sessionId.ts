import { createFileRoute } from "@tanstack/react-router";
import type { SessionSubscriptionEvent } from "@sessions/model";
import { subscribeToSession } from "@sessions/server/runtime";
import { createSseResponse } from "@/shared/server/sse";

export const Route = createFileRoute("/api/sessions/$sessionId")({
  server: {
    handlers: {
      // Brings the subscriber current from an optional revision, then streams live work until it ends.
      GET: ({ params, request }) => {
        const query = new URL(request.url).searchParams;
        const after = Number(query.get("after")?.trim() || NaN);
        return createSseResponse<SessionSubscriptionEvent>(request, (send, close) =>
          subscribeToSession(
            params.sessionId,
            send,
            close,
            Number.isSafeInteger(after) && after >= 0 ? after : undefined,
          ),
        );
      },
    },
  },
});
