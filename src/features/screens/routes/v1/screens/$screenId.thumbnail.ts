import { createFileRoute } from "@tanstack/react-router";
import { screenRuntime } from "@screens/server/runtime";
import { respond } from "@/shared/server/http";

/** A screen as it is now, as JPEG bytes a native app can show directly. */
export const Route = createFileRoute("/api/v1/screens/$screenId/thumbnail")({
  server: {
    handlers: {
      GET: ({ params }) =>
        respond(`capture screen ${params.screenId}`, async () => {
          const jpeg = await screenRuntime.thumbnail(params.screenId);
          return new Response(Buffer.from(jpeg, "base64"), {
            headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
          });
        }),
    },
  },
});
