import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { useSelector } from "@tanstack/react-store";
import { workerMutations } from "@workers/mutations";
import { workerQueries } from "@workers/queries";
import type { SpawnWorkerInput, Worker } from "@workers/model";
import { releaseLease } from "@workspace/server/functions";
import { applyWorkspaceEvent, workspaceConnection } from "@workspace/sync";
import { fileMutations } from "./mutations";
import { workspaceFileId, type WorkspaceFile, type WorkspaceFileMode } from "./model";
import { fileQueries } from "./queries";
import { watchFile } from "./server/functions";

const SAVE_DEBOUNCE_MS = 2_000;
const SAVE_SETTLE_MS = 1_000;

type FileFlushOptions = { notifyAgent?: boolean };

type FileWorkerInput = Extract<SpawnWorkerInput, { type: "file" }>;
export type WorkerRequest = Pick<FileWorkerInput, "name" | "metadata"> & {
  prompt: FileWorkerInput["message"]["content"];
};

/** A file's content lifecycle plus the pending workers scoped to it. */
export type WorkspaceFileState = {
  /** File address whose live content and persistence lifecycle this state owns. */
  source: WorkspaceFile;
  /** Content as of `revision`. Own saves leave it as is, so a mounted renderer keeps its buffer. */
  content: string | null;
  /** External file revision. Own saves do not advance it or reset renderer state. */
  revision: number;
  /** This pane's latest text, including unsaved edits, for a renderer that mounts after them. */
  latest: () => string | null;
  isReady: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  save: (content: string) => void;
  flush: (options?: FileFlushOptions) => Promise<void>;
  workers: Extract<Worker, { type: "file" }>[];
  spawnWorker?: (request: WorkerRequest) => Promise<{ sessionId: string }>;
  cancelWorker: (workerSessionId: string) => Promise<void>;
};

/** One edit this pane made, and the external revision it was made against. */
type FileEdit = { content: string; revision: number };

/** A pane's latest text: its last edit, until a newer external version replaces it. */
export function latestContent(
  file: Pick<WorkspaceFileState, "content" | "revision">,
  edit: Pick<WorkspaceFileState, "content" | "revision"> | null,
): string | null {
  return edit?.revision === file.revision ? edit.content : file.content;
}

/**
 * The content a renderer starts from when it mounts, then each external version. A renderer
 * that mounts into an open pane, as on a kind switch, picks up the pane's own edits.
 */
export function useMountedContent(file: WorkspaceFileState): string | null {
  const [seed] = useState(() => ({ revision: file.revision, content: file.latest() }));
  return latestContent(file, seed);
}

export function useFile(file: WorkspaceFile, mode: WorkspaceFileMode): WorkspaceFileState {
  const queryClient = useQueryClient();

  const [showSaveIndicator, setShowSaveIndicator] = useState(false);
  const [writtenTimestamp, setWrittenTimestamp] = useState<number | null>(null);

  const editRef = useRef<FileEdit | null>(null);
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
  const revision = known?.timestamp ?? 0;

  const write = useMutation({
    ...fileMutations.write(file),
    onMutate: () => {
      settleTask.cancel();
      setShowSaveIndicator(true);
    },
    onSuccess: (result, { content: written }) => {
      setWrittenTimestamp(result.timestamp);
      // The save is now the file's known version, so its own change notice is no news.
      queryClient.setQueryData(fileQueries.detailKey(fileId), {
        content: written,
        timestamp: result.timestamp,
      });
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
    ...workerQueries.active,
    select: (active) =>
      active.filter(
        (worker): worker is Extract<Worker, { type: "file" }> =>
          worker.type === "file" && workspaceFileId(worker.file) === fileId,
      ),
  });

  const saveTask = useDebouncer(
    () => {
      const edit = editRef.current!;
      // A newer external version replaced this edit in the pane, so writing it would clobber that.
      if (edit.revision !== revision) return;
      const { notifyAgent = true } = flushOptionsRef.current ?? {};
      const pendingSave = write.mutateAsync({
        content: edit.content,
        notifyAgent: mode === "shared" && notifyAgent,
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
    editRef.current = { content: nextContent, revision };
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
    await workerQueries.active.refresh(queryClient);
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
    revision,
    latest: () => latestContent({ content, revision }, editRef.current),
    isReady: content !== null,
    isLoading: read.isPending,
    isSaving: write.isPending || showSaveIndicator,
    error:
      known === null
        ? "This file was deleted."
        : known?.content === null
          ? "This file isn't text."
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
