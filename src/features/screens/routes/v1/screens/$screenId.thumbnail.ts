import { createFileRoute } from "@tanstack/react-router";
import { screenRuntime } from "@screens/server/runtime";
import { respond } from "@/shared/server/http";

/** A screen as it is now, as JPEG bytes the screen browser and native apps show directly. */
export const Route = createFileRoute("/api/v1/screens/$screenId/thumbnail")({
  server: {
    handlers: {
      GET: ({ params }) =>
        respond(`capture screen ${params.screenId}`, async () => {
          const jpeg = await screenRuntime.thumbnail(params.screenId);
          return new Response(jpeg, {
            headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
          });
        }),
    },
  },
});
