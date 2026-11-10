import { createFileRoute } from "@tanstack/react-router";
import { screenRuntime } from "@screens/server/runtime";

/** The displays and windows a native app can view, as the browser's `listScreens` lists them. */
export const Route = createFileRoute("/api/v1/screens/")({
  server: {
    handlers: {
      GET: () =>
        screenRuntime.list().then(
          (list) => Response.json(list, { headers: { "Cache-Control": "no-store" } }),
          (error: Error) => Response.json({ error: error.message }, { status: 422 }),
        ),
    },
  },
});
