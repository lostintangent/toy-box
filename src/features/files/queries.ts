import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { workspaceFileId, type WorkspaceFile } from "./model";
import { listDirectory, readFile } from "./server/functions";

// Artifact-first drafts briefly expose their file before the SDK workspace exists.
const READ_RETRY_COUNT = 20;
const READ_RETRY_DELAY_MS = 150;

type FileSnapshot = Awaited<ReturnType<typeof readFile>>;

export const fileQueries = {
  all: () => ["files"] as const,
  browseKey: (path: string | undefined, showHidden: boolean) =>
    [...fileQueries.all(), "browse", path ?? null, showHidden] as const,
  detailKey: (fileId: string) => [...fileQueries.all(), fileId] as const,

  browse: (path: string | undefined, showHidden: boolean) =>
    queryOptions({
      queryKey: fileQueries.browseKey(path, showHidden),
      queryFn: () => listDirectory({ data: { path, showHidden } }),
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
