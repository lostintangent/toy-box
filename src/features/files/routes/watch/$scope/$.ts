import { createFileRoute } from "@tanstack/react-router";
import { Debouncer } from "@tanstack/pacer/debouncer";
import type { FSWatcher } from "node:fs";
import { createSseResponse } from "@/shared/server/sse";
import type { FileWatchEvent } from "@files/model";
import { resolveFileRequest } from "@files/server/request";

type WatchRouteParams = {
  scope: string;
  _splat?: string;
};

const WATCH_DEBOUNCE_MS = 50;

async function statWatchedFile(absolutePath: string): Promise<FileWatchEvent> {
  try {
    return {
      type: "modified",
      timestamp: (await Bun.file(absolutePath).stat()).mtimeMs,
    };
  } catch {
    return { type: "deleted" };
  }
}

async function createWatchResponse(params: WatchRouteParams, request: Request): Promise<Response> {
  const { scope, _splat } = params;
  const resolution = await resolveFileRequest(scope, _splat);
  if ("error" in resolution) return resolution.error;
  const { absolutePath } = resolution;

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

export const Route = createFileRoute("/api/watch/$scope/$")({
  server: {
    handlers: {
      GET: ({ params, request }) => createWatchResponse(params as WatchRouteParams, request),
    },
  },
});
