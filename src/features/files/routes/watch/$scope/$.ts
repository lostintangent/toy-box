import { createFileRoute } from "@tanstack/react-router";
import { createSseResponse } from "@/shared/server/sse";
import type { FileWatchEvent } from "@files/model";
import { resolveFileRequest } from "@files/server/request";
import { fileWatcher } from "@files/server/watcher";

type WatchRouteParams = {
  scope: string;
  _splat?: string;
};

export async function createWatchResponse(
  params: WatchRouteParams,
  request: Request,
): Promise<Response> {
  const { scope, _splat } = params;
  const resolution = await resolveFileRequest(scope, _splat);
  if ("error" in resolution) return resolution.error;
  const { absolutePath } = resolution;

  return createSseResponse<FileWatchEvent>(request, (send, close) => {
    try {
      return fileWatcher.observeFile(absolutePath, send, close);
    } catch {
      close();
    }
  });
}

export const Route = createFileRoute("/api/watch/$scope/$")({
  server: {
    handlers: {
      GET: ({ params, request }) => createWatchResponse(params as WatchRouteParams, request),
    },
  },
});
