import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { useSelector } from "@tanstack/react-store";
import { sendSystemMessage } from "@sessions/server/functions";
import { invalidateActiveWorkersQuery } from "@workers/cache";
import { workerMutations } from "@workers/mutations";
import { workerQueries } from "@workers/queries";
import type { SpawnWorkerInput, Worker } from "@workers/model";
import { releaseLease } from "@workspace/server/functions";
import { applyWorkspaceEvent, workspaceConnection } from "@workspace/sync";
import { fileMutations } from "./mutations";
import {
  ownerSessionId,
  workspaceFileId,
  type WorkspaceFile,
  type WorkspaceFileMode,
} from "./model";
import { fileQueries } from "./queries";
import { watchFile } from "./server/functions";

const SAVE_DEBOUNCE_MS = 2_000;
const SAVE_SETTLE_MS = 1_000;
const FILE_EDIT_SYSTEM_MESSAGE_DEBOUNCE_MS = 8_000;

type FileFlushOptions = { notifyAgent?: boolean };

type FileWorkerInput = Extract<SpawnWorkerInput, { type: "file" }>;
export type WorkerRequest = Pick<FileWorkerInput, "name" | "metadata"> & {
  prompt: FileWorkerInput["message"]["content"];
};

export type FileState = {
  /** File address whose live content and persistence lifecycle this state owns. */
  source: WorkspaceFile;
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
  const scheduleFileEditSystemMessage = useFileEditSystemMessage({
    enabled: mode === "shared",
    file,
  });

  const [showSaveIndicator, setShowSaveIndicator] = useState(false);
  const [writtenTimestamp, setWrittenTimestamp] = useState<number | null>(null);

  const pendingContentRef = useRef("");
  const flushOptionsRef = useRef<FileFlushOptions | undefined>(undefined);
  const latestSaveRef = useRef<Promise<unknown> | null>(null);
  const settleTask = useDebouncer(() => setShowSaveIndicator(false), { wait: SAVE_SETTLE_MS });

  // Stable string identity so the watch effect keys off value, not object identity.
  const fileId = workspaceFileId(file);

  const read = useQuery(fileQueries.detail(file));
  // This surface's view of the file follows every version except its own saves, so a save never
  // pushes possibly older content back into its renderer, while other surfaces of the file in this
  // tab still pick the save up.
  const [known, setKnown] = useState(read.data);
  if (read.data !== known && read.data?.timestamp !== writtenTimestamp) setKnown(read.data);
  const content = known?.content ?? null;

  const write = useMutation({
    ...fileMutations.write(file),
    onMutate: () => {
      settleTask.cancel();
      setShowSaveIndicator(true);
    },
    onSuccess: (result, { content: written, notifyAgent }) => {
      setWrittenTimestamp(result.timestamp);
      // The save is now the file's known version, so its own change notice is no news.
      queryClient.setQueryData(fileQueries.detailKey(fileId), {
        content: written,
        timestamp: result.timestamp,
      });
      if (notifyAgent) scheduleFileEditSystemMessage();
    },
    onSettled: () => {
      setShowSaveIndicator(true);
      settleTask.maybeExecute();
    },
  });
  const spawn = useMutation(workerMutations.spawn);
  const cancel = useMutation(workerMutations.cancel);

  // Pending workers scoped to this file. A machine file has no owner, so no workers.
  const { data: workers } = useSuspenseQuery({
    ...workerQueries.active(),
    select: (active) =>
      active.filter(
        (worker): worker is Extract<Worker, { type: "file" }> =>
          worker.type === "file" && workspaceFileId(worker.file) === fileId,
      ),
  });

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
    if (file.kind !== "session") {
      throw new Error("Background workers aren't available for this file.");
    }
    await flush({ notifyAgent: false });
    const { prompt, ...details } = request;
    const worker = await spawn.mutateAsync({
      ...details,
      type: "file",
      file,
      message: { content: prompt },
    });
    await invalidateActiveWorkersQuery(queryClient);
    return worker;
  }

  async function cancelWorker(workerSessionId: string): Promise<void> {
    if (file.kind !== "session") return;
    await cancel.mutateAsync({ type: "file", file, workerSessionId });
  }

  // Once read, the file stays watched for as long as this tab's workspace connection holds it.
  // Changes arrive as workspace events; the watch's own reply covers any change since the read.
  const connection = useSelector(workspaceConnection);
  const watching = connection !== null && read.isSuccess;
  const watch = useEffectEvent((connection: string) => watchFile({ data: { connection, file } }));

  useEffect(() => {
    if (!watching) return;
    const watched = watch(connection).catch((error) => {
      console.error("Unable to watch this file:", error);
    });
    void watched.then((result) => result && applyWorkspaceEvent(queryClient, result.change));
    return () => {
      void watched.then((result) => {
        if (result?.lease) void releaseLease({ data: { connection, lease: result.lease } });
      });
    };
  }, [watching, connection, fileId, queryClient]);

  return {
    source: file,
    content,
    revision: known?.timestamp ?? 0,
    isReady: content !== null,
    isLoading: read.isPending,
    isSaving: write.isPending || showSaveIndicator,
    error:
      known === null
        ? "This file was deleted."
        : write.isError
          ? "Unable to save this file."
          : read.isError
            ? "Unable to load this file."
            : null,
    save,
    flush,
    workers,
    spawnWorker: file.kind === "session" ? spawnWorker : undefined,
    cancelWorker,
  };
}

/** Tell the owning Session about shared edits after the file itself is durable. */
function useFileEditSystemMessage({
  enabled,
  file,
}: {
  enabled: boolean;
  file: WorkspaceFile;
}): () => void {
  const owner = ownerSessionId(file);
  const systemMessageTask = useDebouncer(
    () => {
      if (!owner) return;
      void sendSystemMessage({
        data: { sessionId: owner, message: { type: "file_edited", file } },
      }).catch((error) => {
        console.error("Failed to deliver file edit system message:", error);
      });
    },
    {
      enabled,
      wait: FILE_EDIT_SYSTEM_MESSAGE_DEBOUNCE_MS,
      onUnmount: (debouncer) => debouncer.flush(),
    },
  );

  return systemMessageTask.maybeExecute;
}
