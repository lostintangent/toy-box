import { createFileRoute } from "@tanstack/react-router";
import { screenRuntime } from "@screens/server/runtime";
import { respond } from "@/shared/server/http";

/** The displays and windows a native app can view, as the browser's `listScreens` lists them. */
export const Route = createFileRoute("/api/v1/screens/")({
  server: {
    handlers: {
      GET: () => respond("list screens", () => screenRuntime.list()),
    },
  },
});
