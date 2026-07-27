import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { readFile, writeFile } from "@/functions/files";
import {
  cancelWorker as requestCancelWorker,
  spawnWorker as requestSpawnWorker,
} from "@/functions/workers";
import { notifyAgent } from "@/functions/sessions";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
import { SerialTaskQueue } from "@/lib/serialTaskQueue";
import { ownerSessionId, workspaceFileId } from "@/lib/files/workspaceFile";
import type { EditorPaneMode } from "@/lib/workspace/panes";
import { createFileRouteUrl } from "@/lib/files/paths";
import type { FileWatchEvent, JsonValue, Worker, WorkspaceFile } from "@/types";

const SAVE_DEBOUNCE_MS = 2_000;
const SAVE_SETTLE_MS = 1_000;
const FILE_EDIT_NOTIFICATION_DEBOUNCE_MS = 8_000;
// While an artifact-first draft's workspace materializes, poll at a short fixed
// interval rather than backing off — we are waiting for a resource to exist.
const READ_RETRY_COUNT = 20;
const READ_RETRY_DELAY_MS = 150;

type FileFlushOptions = { notifyAgent?: boolean };
type FileRead = Awaited<ReturnType<typeof readFile>>;

// The read query keys off the file's identity; the helper keeps `file` in the key
// expression (which the query lint requires) while the watch effect keys off the id string.
const fileKey = (file: WorkspaceFile) => ["file", workspaceFileId(file)] as const;

export type WorkerRequest = { name?: string; prompt: string; metadata?: JsonValue };

export type FileState = {
  /** Last known on-disk content; the renderer owns its editing buffer. */
  content: string | null;
  /** External file revision. Own saves do not advance it or reset renderer state. */
  revision: number;
  isReady: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  save: (content: string) => void;
  flush: (options?: FileFlushOptions) => Promise<void>;
};

/** A file's content lifecycle plus the pending workers scoped to it. */
type WorkspaceFileState = FileState & {
  workers: Worker[];
  spawnWorker: (request: WorkerRequest) => Promise<{ sessionId: string }>;
  cancelWorker: (workerSessionId: string) => Promise<void>;
};

export function useWorkspaceFile(file: WorkspaceFile, mode: EditorPaneMode): WorkspaceFileState {
  const queryClient = useQueryClient();
  const owner = ownerSessionId(file);
  const scheduleAgentNotification = useFileEditNotification({
    enabled: mode === "shared",
    file,
  });

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveQueue] = useState(() => new SerialTaskQueue());

  const pendingContentRef = useRef("");
  const flushOptionsRef = useRef<FileFlushOptions | undefined>(undefined);
  const lastWrittenTimestampRef = useRef<number | null>(null);
  const settleTask = useDebouncer(() => setIsSaving(false), { wait: SAVE_SETTLE_MS });

  // Stable string identity so the watch effect keys off value, not object identity.
  const fileId = workspaceFileId(file);

  // The external on-disk read. Retries bridge the brief window where an
  // artifact-first draft's pane is visible before its SDK workspace exists.
  const read = useQuery({
    queryKey: fileKey(file),
    queryFn: (): Promise<FileRead | null> => readFile({ data: { file } }),
    retry: READ_RETRY_COUNT,
    retryDelay: READ_RETRY_DELAY_MS,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const content = read.data?.content ?? null;

  // Pending workers scoped to this file. A machine file has no owner, so no workers.
  const workers = useWorkspaceSelector((workspace) =>
    workspace.workers.filter((worker) => worker.file && workspaceFileId(worker.file) === fileId),
  );

  const saveTask = useDebouncer(
    () => {
      const { notifyAgent = true } = flushOptionsRef.current ?? {};
      const nextContent = pendingContentRef.current;
      setIsSaving(true);
      settleTask.cancel();
      const save = saveQueue.enqueue(async () => {
        const result = await writeFile({
          data: { file, content: nextContent },
        });
        lastWrittenTimestampRef.current = result.timestamp;
        setError(null);
        if (notifyAgent) scheduleAgentNotification();
      });
      void save.then(
        () => settleTask.maybeExecute(),
        () => {
          setError("Unable to save this file.");
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

  function flush(options?: FileFlushOptions): Promise<void> {
    flushOptionsRef.current = options;
    saveTask.flush();
    flushOptionsRef.current = undefined;
    return saveQueue.waitForPending();
  }

  // Spawn a renderer-authored worker for this file, flushing pending edits first so
  // the worker reads the user's latest content.
  async function spawnWorker(request: WorkerRequest): Promise<{ sessionId: string }> {
    if (owner === undefined) throw new Error("Background workers aren't available for this file.");
    await flush({ notifyAgent: false });
    const { name, prompt, metadata } = request;
    return requestSpawnWorker({
      data: {
        file,
        ...(name === undefined ? {} : { name }),
        prompt,
        ...(metadata === undefined ? {} : { metadata }),
      },
    });
  }

  async function cancelWorker(workerSessionId: string): Promise<void> {
    if (owner === undefined) return;
    await requestCancelWorker({ data: { file, workerSessionId } });
  }

  // Watch the file once it exists, invalidating the read on external change.
  // Own writes are suppressed by timestamp so a save never re-baselines the renderer.
  const watchUrl = createFileRouteUrl("/api/watch", file);

  useEffect(() => {
    if (!read.isSuccess) return;
    const source = new EventSource(watchUrl);
    source.onmessage = ({ data }) => {
      const event = JSON.parse(data) as FileWatchEvent;
      if (event.type === "deleted") {
        queryClient.setQueryData(["file", fileId], null);
        setError("This file was deleted.");
        return;
      }
      if (event.timestamp === lastWrittenTimestampRef.current) return;
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["file", fileId] });
    };
    source.onerror = () => setError("Unable to watch this file.");
    return () => source.close();
  }, [watchUrl, fileId, read.isSuccess, queryClient]);

  return {
    content,
    revision: read.data?.timestamp ?? 0,
    isReady: content !== null,
    isLoading: read.isPending,
    isSaving,
    error: error ?? (read.isError ? "Unable to load this file." : null),
    save,
    flush,
    workers,
    spawnWorker,
    cancelWorker,
  };
}

/** Debounced side-channel that nudges the owning agent after the user edits a shared file. */
function useFileEditNotification({
  enabled,
  file,
}: {
  enabled: boolean;
  file: WorkspaceFile;
}): () => void {
  const owner = ownerSessionId(file);
  const notificationTask = useDebouncer(
    () => {
      if (!owner) return;
      void notifyAgent({
        data: { sessionId: owner, notification: { type: "file_edited", file } },
      }).catch((error) => {
        console.error("Failed to notify agent about file edit:", error);
      });
    },
    {
      enabled: enabled && owner !== undefined,
      wait: FILE_EDIT_NOTIFICATION_DEBOUNCE_MS,
      onUnmount: (debouncer) => debouncer.flush(),
    },
  );

  return notificationTask.maybeExecute;
}
