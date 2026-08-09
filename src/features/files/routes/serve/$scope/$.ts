import { createFileRoute } from "@tanstack/react-router";
import { resolveFileRequest } from "@files/server/request";

type ServeRouteParams = {
  scope: string;
  _splat?: string;
};

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
};

// Serve raw file bytes for relative resources referenced by rendered files.
// Read/write use RPCs; this endpoint exists for browser-native URL loading.
export const Route = createFileRoute("/api/serve/$scope/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { scope, _splat } = params as ServeRouteParams;
        const resolution = await resolveFileRequest(scope, _splat);
        if ("error" in resolution) return resolution.error;
        const { absolutePath } = resolution;

        try {
          return new Response(Bun.file(absolutePath), {
            headers: {
              "Cache-Control": "no-store",
              "Content-Security-Policy":
                "sandbox allow-downloads allow-forms allow-modals allow-popups allow-scripts allow-top-navigation-by-user-activation",
              "Content-Type": getContentType(absolutePath),
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch {
          return new Response("Unable to read file.", { status: 404 });
        }
      },
    },
  },
});

function getContentType(path: string): string {
  const extension = path.match(/\.[^.\\/]+$/)?.[0]?.toLowerCase();
  return (extension && CONTENT_TYPES[extension]) || "application/octet-stream";
}
