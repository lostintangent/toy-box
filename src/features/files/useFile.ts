import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { notifyAgent } from "@sessions/server/functions";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { workerMutations } from "@workers/mutations";
import type { SpawnWorkerInput, Worker } from "@workers/model";
import { fileMutations } from "./mutations";
import {
  ownerSessionId,
  workspaceFileId,
  type FileWatchEvent,
  type WorkspaceFile,
  type WorkspaceFileMode,
} from "./model";
import { createFileRouteUrl } from "./model/paths";
import { fileQueries } from "./queries";

const SAVE_DEBOUNCE_MS = 2_000;
const SAVE_SETTLE_MS = 1_000;
const FILE_EDIT_NOTIFICATION_DEBOUNCE_MS = 8_000;

type FileFlushOptions = { notifyAgent?: boolean };

type FileWorkerInput = Extract<SpawnWorkerInput, { type: "file" }>;
export type WorkerRequest = Pick<FileWorkerInput, "name" | "metadata"> & {
  prompt: FileWorkerInput["message"]["content"];
};

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
  workers: Extract<Worker, { type: "file" }>[];
  spawnWorker?: (request: WorkerRequest) => Promise<{ sessionId: string }>;
  cancelWorker: (workerSessionId: string) => Promise<void>;
};

export function useFile(file: WorkspaceFile, mode: WorkspaceFileMode): WorkspaceFileState {
  const queryClient = useQueryClient();
  const scheduleAgentNotification = useFileEditNotification({
    enabled: mode === "shared",
    file,
  });

  const [showSaveIndicator, setShowSaveIndicator] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);

  const pendingContentRef = useRef("");
  const flushOptionsRef = useRef<FileFlushOptions | undefined>(undefined);
  const latestSaveRef = useRef<Promise<unknown> | null>(null);
  const lastWrittenTimestampRef = useRef<number | null>(null);
  const settleTask = useDebouncer(() => setShowSaveIndicator(false), { wait: SAVE_SETTLE_MS });

  // Stable string identity so the watch effect keys off value, not object identity.
  const fileId = workspaceFileId(file);

  const read = useQuery(fileQueries.detail(file));
  const content = read.data?.content ?? null;

  const write = useMutation({
    ...fileMutations.write(file),
    onMutate: () => {
      settleTask.cancel();
      setShowSaveIndicator(true);
    },
    onSuccess: (result, { notifyAgent }) => {
      lastWrittenTimestampRef.current = result.timestamp;
      setWatchError(null);
      if (notifyAgent) scheduleAgentNotification();
    },
    onSettled: () => {
      setShowSaveIndicator(true);
      settleTask.maybeExecute();
    },
  });
  const spawn = useMutation(workerMutations.spawn);
  const cancel = useMutation(workerMutations.cancel);

  // Pending workers scoped to this file. A machine file has no owner, so no workers.
  const workers = useWorkspaceSelector((workspace) =>
    workspace.workers.filter(
      (worker): worker is Extract<Worker, { type: "file" }> =>
        worker.type === "file" && workspaceFileId(worker.file) === fileId,
    ),
  );

  const saveTask = useDebouncer(
    () => {
      const { notifyAgent = true } = flushOptionsRef.current ?? {};
      const nextContent = pendingContentRef.current;
      const pendingSave = write.mutateAsync({
        content: nextContent,
        notifyAgent,
      });
      latestSaveRef.current = pendingSave;
      void pendingSave.catch(() => undefined);
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
    // The shared file scope puts every earlier write ahead of this promise.
    return latestSaveRef.current?.then(() => undefined) ?? Promise.resolve();
  }

  // Spawn a renderer-authored worker for this file, flushing pending edits first so
  // the worker reads the user's latest content.
  async function spawnWorker(request: WorkerRequest): Promise<{ sessionId: string }> {
    if (file.type !== "session") {
      throw new Error("Background workers aren't available for this file.");
    }
    await flush({ notifyAgent: false });
    const { prompt, ...details } = request;
    return spawn.mutateAsync({
      ...details,
      type: "file",
      file,
      message: { content: prompt },
    });
  }

  async function cancelWorker(workerSessionId: string): Promise<void> {
    if (file.type !== "session") return;
    await cancel.mutateAsync({ type: "file", file, workerSessionId });
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
        queryClient.setQueryData(fileQueries.detailKey(fileId), null);
        setWatchError("This file was deleted.");
        return;
      }
      if (event.timestamp === lastWrittenTimestampRef.current) return;
      setWatchError(null);
      void queryClient.invalidateQueries({ queryKey: fileQueries.detailKey(fileId) });
    };
    source.onerror = () => setWatchError("Unable to watch this file.");
    return () => source.close();
  }, [watchUrl, fileId, read.isSuccess, queryClient]);

  return {
    content,
    revision: read.data?.timestamp ?? 0,
    isReady: content !== null,
    isLoading: read.isPending,
    isSaving: write.isPending || showSaveIndicator,
    error:
      watchError ??
      (write.isError
        ? "Unable to save this file."
        : read.isError
          ? "Unable to load this file."
          : null),
    save,
    flush,
    workers,
    spawnWorker: file.type === "session" ? spawnWorker : undefined,
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
