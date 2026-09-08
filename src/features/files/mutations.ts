import { mutationOptions } from "@tanstack/react-query";
import { workspaceFileId, type CreateFileInput, type WorkspaceFile } from "./model";
import type { MentionFileAgentInput } from "./model/agentMention";
import { createFile, writeFile, mentionFileAgent } from "./server/functions";

import { agentQueries } from "@agents/queries";

type FileWrite = {
  content: string;
  notifyAgent: boolean;
};

export const fileMutations = {
  mentionAgent: () =>
    mutationOptions({
      mutationFn: (input: MentionFileAgentInput) => mentionFileAgent({ data: input }),
      onSuccess: (_result, input, _mutation, { client }) => {
        void client.invalidateQueries({
          queryKey: agentQueries.membershipList(input.host).queryKey,
          exact: true,
        });
      },
    }),
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
