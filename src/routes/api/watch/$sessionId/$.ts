import { createFileRoute } from "@tanstack/react-router";
import type { FSWatcher } from "node:fs";
import { createSseResponse } from "@/routes/api/-lib/sse";
import { resolveArtifactRequest } from "@/routes/api/-lib/artifactRequest";
import type { FileWatchEvent } from "@/types";

type WatchRouteParams = {
  sessionId: string;
  _splat?: string;
};

const WATCH_DEBOUNCE_MS = 50;

async function statWatchedFile(path: string): Promise<FileWatchEvent> {
  try {
    const { stat } = await import("node:fs/promises");
    return { type: "modified", timestamp: (await stat(path)).mtimeMs };
  } catch {
    return { type: "deleted" };
  }
}

async function createWatchResponse(params: WatchRouteParams, request: Request): Promise<Response> {
  const { path: targetPath, error } = await resolveArtifactRequest(params.sessionId, params._splat);
  if (error) return error;

  return createSseResponse<FileWatchEvent>(request, async (send, close) => {
    let watcher: FSWatcher | undefined;
    let changeTimer: ReturnType<typeof setTimeout> | undefined;

    const sendChangeEvent = () => {
      if (changeTimer) clearTimeout(changeTimer);
      changeTimer = setTimeout(async () => {
        send(await statWatchedFile(targetPath));
      }, WATCH_DEBOUNCE_MS);
    };

    try {
      const { watch } = await import("node:fs");
      watcher = watch(targetPath, sendChangeEvent);
      watcher.on("error", close);
    } catch {
      close();
    }

    return () => {
      watcher?.close();
      if (changeTimer) clearTimeout(changeTimer);
    };
  });
}

export const Route = createFileRoute("/api/watch/$sessionId/$")({
  server: {
    handlers: {
      GET: ({ params, request }) => createWatchResponse(params as WatchRouteParams, request),
    },
  },
});
