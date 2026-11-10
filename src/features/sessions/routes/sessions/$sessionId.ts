import { createFileRoute } from "@tanstack/react-router";
import type { SessionEvent } from "@sessions/model";
import { followSession } from "@sessions/server/runtime";
import { createSseResponse } from "@/shared/server/sse";

export const Route = createFileRoute("/api/sessions/$sessionId")({
  server: {
    handlers: {
      // Follows live work after an optional cursor, and ends at once when the session is idle.
      GET: ({ params, request }) => {
        const query = new URL(request.url).searchParams;
        const after = Number(query.get("after")?.trim() || NaN);
        return createSseResponse<SessionEvent>(request, async (send, close) => {
          const subscription = await followSession(
            params.sessionId,
            Number.isSafeInteger(after) && after >= 0 ? after : undefined,
          );
          if (!subscription) return close();
          void (async () => {
            for await (const event of subscription) send(event);
            close();
          })();
          return () => void subscription.return();
        });
      },
    },
  },
});
