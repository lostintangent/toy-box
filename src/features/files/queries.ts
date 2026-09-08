import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { workspaceFileId, type WorkspaceFile } from "./model";
import { listDirectory, readFile } from "./server/functions";

// Artifact-first drafts briefly expose their file before the SDK workspace exists.
const READ_RETRY_COUNT = 20;
const READ_RETRY_DELAY_MS = 150;

type FileSnapshot = Awaited<ReturnType<typeof readFile>>;

export const fileQueries = {
  all: () => ["files"] as const,
  browseKey: (path: string | undefined, showDotfiles: boolean) =>
    [...fileQueries.all(), "browse", path ?? null, showDotfiles] as const,
  detailKey: (fileId: string) => [...fileQueries.all(), fileId] as const,

  browse: (path: string | undefined, showDotfiles: boolean) =>
    queryOptions({
      queryKey: fileQueries.browseKey(path, showDotfiles),
      queryFn: () => listDirectory({ data: { path, showDotfiles } }),
      placeholderData: keepPreviousData,
      retry: false,
    }),

  detail: (file: WorkspaceFile) =>
    queryOptions({
      queryKey: fileQueries.detailKey(workspaceFileId(file)),
      queryFn: (): Promise<FileSnapshot | null> => readFile({ data: { file } }),
      retry: READ_RETRY_COUNT,
      retryDelay: READ_RETRY_DELAY_MS,
      staleTime: Infinity,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
};
