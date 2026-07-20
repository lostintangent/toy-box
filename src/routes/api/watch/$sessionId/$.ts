import { createFileRoute } from "@tanstack/react-router";
import { Debouncer } from "@tanstack/pacer/debouncer";
import type { FSWatcher } from "node:fs";
import { createSseResponse } from "@/routes/api/-lib/sse";
import { resolveArtifactRequest } from "@/routes/api/-lib/artifactRequest";
import type { FileWatchEvent } from "@/types";

type WatchRouteParams = {
  sessionId: string;
  _splat?: string;
};

const WATCH_DEBOUNCE_MS = 50;

async function statWatchedFile(absolutePath: string): Promise<FileWatchEvent> {
  try {
    const { stat } = await import("node:fs/promises");
    return { type: "modified", timestamp: (await stat(absolutePath)).mtimeMs };
  } catch {
    return { type: "deleted" };
  }
}

async function createWatchResponse(params: WatchRouteParams, request: Request): Promise<Response> {
  const { sessionId, _splat } = params;
  const { absolutePath, error } = await resolveArtifactRequest(sessionId, _splat);
  if (error) return error;

  return createSseResponse<FileWatchEvent>(request, async (send, close) => {
    let watcher: FSWatcher | undefined;
    const changeEvents = new Debouncer(async () => send(await statWatchedFile(absolutePath)), {
      wait: WATCH_DEBOUNCE_MS,
    });

    try {
      const { watch } = await import("node:fs");
      watcher = watch(absolutePath, changeEvents.maybeExecute);
      watcher.on("error", close);
    } catch {
      close();
    }

    return () => {
      watcher?.close();
      changeEvents.cancel();
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
