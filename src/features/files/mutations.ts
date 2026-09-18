import { mutationOptions } from "@tanstack/react-query";
import { workspaceFileId, type CreateFileInput, type WorkspaceFile } from "./model";
import { createFile, writeFile } from "./server/functions";

type FileWrite = {
  content: string;
  notifyAgent: boolean;
};

export const fileMutations = {
  create: () =>
    mutationOptions({
      mutationFn: (input: CreateFileInput) => createFile({ data: input }),
    }),

  write: (file: WorkspaceFile) => {
    const fileId = workspaceFileId(file);
    return mutationOptions({
      scope: { id: `file:${fileId}` },
      mutationFn: ({ content }: FileWrite) => writeFile({ data: { file, content } }),
    });
  },
};
