import { createFileRoute } from "@tanstack/react-router";
import { screenRuntime } from "@screens/server/runtime";

/** A screen as it is now, as JPEG bytes a native app can show directly. */
export const Route = createFileRoute("/api/v1/screens/$screenId/thumbnail")({
  server: {
    handlers: {
      GET: ({ params }) =>
        screenRuntime.thumbnail(params.screenId).then(
          (jpeg) =>
            new Response(Buffer.from(jpeg, "base64"), {
              headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" },
            }),
          (error: Error) => Response.json({ error: error.message }, { status: 422 }),
        ),
    },
  },
});
