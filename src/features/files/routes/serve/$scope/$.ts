import { createFileRoute } from "@tanstack/react-router";
import { HTML_SANDBOX_CONTENT_SECURITY_POLICY } from "@/shared/embeddedHtml";
import { decodeFileRoute } from "@files/model";
import { resolveWorkspaceFile } from "@files/server/paths";

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
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

export async function createServeResponse(
  { scope, _splat }: ServeRouteParams,
  request: Request,
): Promise<Response> {
  const requestPath = _splat?.replace(/^\/+/, "");
  if (!requestPath) return new Response("Missing file path.", { status: 400 });
  const absolutePath = resolveWorkspaceFile(decodeFileRoute(scope, requestPath));
  if (!absolutePath) return new Response("Invalid file path.", { status: 403 });
  const stats = await Bun.file(absolutePath)
    .stat()
    .catch(() => null);
  if (!stats) return new Response("File not found.", { status: 404 });
  if (!stats.isFile()) return new Response("Requested path is not a file.", { status: 404 });

  const { size, mtimeMs } = stats;
  const etag = `W/"${size}-${mtimeMs}"`;
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

  // Media elements stream and seek by byte range, and Safari won't play video without ranges and a
  // known length. Bun.serve provides both natively, but the dev server's node:http adapter pipes the
  // Response and drops them. HTTP lets a server ignore other range forms, so they get the whole file.
  const range = request.headers.get("Range")?.match(/^bytes=(\d+)-(\d*)$/);
  if (range) {
    const start = Number(range[1]);
    const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
    if (start <= end) {
      return new Response(Bun.file(absolutePath).slice(start, end + 1), {
        status: 206,
        headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}` },
      });
    }
  }

  return new Response(Bun.file(absolutePath), {
    headers: { ...headers, "Content-Length": String(size) },
  });
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
