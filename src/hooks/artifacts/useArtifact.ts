import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { readArtifact, writeArtifact } from "@/functions/artifacts";
import { notifyAgent } from "@/functions/sessions";
import { SerialTaskQueue } from "@/lib/serialTaskQueue";
import type { ArtifactPaneMode } from "@/lib/workspace/panes";
import { createArtifactRouteUrl } from "@/lib/session/artifacts/paths";
import type { FileWatchEvent } from "@/types";

const SAVE_DEBOUNCE_MS = 2_000;
const SAVE_SETTLE_MS = 1_000;
const ARTIFACT_EDIT_NOTIFICATION_DEBOUNCE_MS = 8_000;
// While an artifact-first draft's workspace materializes, poll at a short fixed
// interval rather than backing off — we are waiting for a resource to exist.
const READ_RETRY_COUNT = 20;
const READ_RETRY_DELAY_MS = 150;

type ArtifactFlushOptions = { notifyAgent?: boolean };
type ArtifactRead = Awaited<ReturnType<typeof readArtifact>>;

const artifactKey = (sessionId: string, path: string) => ["artifact", sessionId, path] as const;

export type Artifact = {
  /** Last known on-disk content; the renderer owns its editing buffer. */
  content: string | null;
  /** External file revision. Own saves do not advance it or reset renderer state. */
  revision: number;
  isReady: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  save: (content: string) => void;
  flush: (options?: ArtifactFlushOptions) => Promise<void>;
};

export function useArtifact({
  sessionId,
  path,
  mode,
}: {
  sessionId: string;
  path: string;
  mode: ArtifactPaneMode;
}): Artifact {
  const queryClient = useQueryClient();
  const scheduleAgentNotification = useArtifactEditNotification({
    enabled: mode === "shared",
    path,
    sessionId,
  });

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveQueue] = useState(() => new SerialTaskQueue());

  const pendingContentRef = useRef("");
  const flushOptionsRef = useRef<ArtifactFlushOptions | undefined>(undefined);
  const lastWrittenTimestampRef = useRef<number | null>(null);
  const settleTask = useDebouncer(() => setIsSaving(false), { wait: SAVE_SETTLE_MS });

  // The external on-disk read. Retries bridge the brief window where an
  // artifact-first draft's pane is visible before its SDK workspace exists.
  const read = useQuery({
    queryKey: artifactKey(sessionId, path),
    queryFn: (): Promise<ArtifactRead | null> => readArtifact({ data: { sessionId, path } }),
    retry: READ_RETRY_COUNT,
    retryDelay: READ_RETRY_DELAY_MS,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const content = read.data?.content ?? null;

  const saveTask = useDebouncer(
    () => {
      const { notifyAgent = true } = flushOptionsRef.current ?? {};
      const nextContent = pendingContentRef.current;
      setIsSaving(true);
      settleTask.cancel();
      const save = saveQueue.enqueue(async () => {
        const result = await writeArtifact({
          data: { sessionId, path, content: nextContent },
        });
        lastWrittenTimestampRef.current = result.timestamp;
        setError(null);
        if (notifyAgent) scheduleAgentNotification();
      });
      void save.then(
        () => settleTask.maybeExecute(),
        () => {
          setError("Unable to save this artifact.");
          settleTask.maybeExecute();
        },
      );
    },
    {
      wait: SAVE_DEBOUNCE_MS,
      onUnmount: (debouncer) => debouncer.flush(),
    },
  );

  function save(nextContent: string) {
    pendingContentRef.current = nextContent;
    saveTask.maybeExecute();
  }

  function flush(options?: ArtifactFlushOptions): Promise<void> {
    flushOptionsRef.current = options;
    saveTask.flush();
    flushOptionsRef.current = undefined;
    return saveQueue.waitForPending();
  }

  // Watch the file once it exists, invalidating the read on external change.
  // Own writes are suppressed by timestamp so a save never re-baselines the renderer.
  useEffect(() => {
    if (!read.isSuccess) return;
    const source = new EventSource(createArtifactRouteUrl("/api/watch", sessionId, path));
    source.onmessage = ({ data }) => {
      const event = JSON.parse(data) as FileWatchEvent;
      if (event.type === "deleted") {
        queryClient.setQueryData(artifactKey(sessionId, path), null);
        setError("This artifact was deleted.");
        return;
      }
      if (event.timestamp === lastWrittenTimestampRef.current) return;
      setError(null);
      void queryClient.invalidateQueries({ queryKey: artifactKey(sessionId, path) });
    };
    source.onerror = () => setError("Unable to watch this artifact.");
    return () => source.close();
  }, [sessionId, path, read.isSuccess, queryClient]);

  return {
    content,
    revision: read.data?.timestamp ?? 0,
    isReady: content !== null,
    isLoading: read.isPending,
    isSaving,
    error: error ?? (read.isError ? "Unable to load this artifact." : null),
    save,
    flush,
  };
}

/** Debounced side-channel that nudges the agent after the user edits a shared artifact. */
function useArtifactEditNotification({
  enabled,
  path,
  sessionId,
}: {
  enabled: boolean;
  path: string;
  sessionId: string;
}): () => void {
  const notificationTask = useDebouncer(
    () => {
      void notifyAgent({
        data: { sessionId, notification: { type: "artifact_edited", path } },
      }).catch((error) => {
        console.error("Failed to notify agent about artifact edit:", error);
      });
    },
    {
      enabled,
      wait: ARTIFACT_EDIT_NOTIFICATION_DEBOUNCE_MS,
      onUnmount: (debouncer) => debouncer.flush(),
    },
  );

  return notificationTask.maybeExecute;
}
