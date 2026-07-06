import { createFileRoute } from "@tanstack/react-router";
import { injectHtmlPreviewBridge, isHtmlPreviewPath } from "@/lib/session/artifacts/htmlPreview";
import { resolveArtifactRequest } from "@/routes/api/-lib/artifactRequest";

type PreviewRouteParams = {
  sessionId: string;
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

export const Route = createFileRoute("/api/preview/$sessionId/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { sessionId, _splat } = params as PreviewRouteParams;
        const { absolutePath, error } = await resolveArtifactRequest(sessionId, _splat);
        if (error) return error;

        try {
          const { readFile } = await import("node:fs/promises");
          const body = isHtmlPreviewPath(absolutePath)
            ? injectHtmlPreviewBridge(await readFile(absolutePath, "utf-8"))
            : await readFile(absolutePath);

          return new Response(body, {
            headers: {
              "Cache-Control": "no-store",
              "Content-Security-Policy":
                "sandbox allow-downloads allow-forms allow-modals allow-popups allow-scripts allow-top-navigation-by-user-activation",
              "Content-Type": getContentType(absolutePath),
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch {
          return new Response("Unable to read preview file.", { status: 404 });
        }
      },
    },
  },
});

function getContentType(path: string): string {
  const extension = path.match(/\.[^.\\/]+$/)?.[0]?.toLowerCase();
  return (extension && CONTENT_TYPES[extension]) || "application/octet-stream";
}
