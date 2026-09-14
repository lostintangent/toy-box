import { createFileRoute } from "@tanstack/react-router";
import { HTML_SANDBOX_CONTENT_SECURITY_POLICY } from "@/shared/embeddedHtml";
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

export async function createServeResponse(
  params: ServeRouteParams,
  request: Request,
): Promise<Response> {
  const { scope, _splat } = params;
  const resolution = await resolveFileRequest(scope, _splat);
  if ("error" in resolution) return resolution.error;
  const { absolutePath, size, modifiedTime } = resolution;
  const etag = `W/"${size}-${modifiedTime}"`;
  const headers = {
    "Cache-Control": "private, no-cache",
    "Content-Security-Policy": HTML_SANDBOX_CONTENT_SECURITY_POLICY,
    "Content-Type": getContentType(absolutePath),
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };

  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(Bun.file(absolutePath), { headers });
}

// Serve raw file bytes for relative resources referenced by rendered files.
// Read/write use RPCs; this endpoint exists for browser-native URL loading.
export const Route = createFileRoute("/api/serve/$scope/$")({
  server: {
    handlers: {
      GET: ({ params, request }) => createServeResponse(params as ServeRouteParams, request),
    },
  },
});

function getContentType(path: string): string {
  const extension = path.match(/\.[^.\\/]+$/)?.[0]?.toLowerCase();
  return (extension && CONTENT_TYPES[extension]) || "application/octet-stream";
}
