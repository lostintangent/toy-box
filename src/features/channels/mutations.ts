import { mutationOptions } from "@tanstack/react-query";
import type {
  BookmarkChannelMessageInput,
  ChannelConversationMessage,
  CreateChannelMemberInput,
  CreateChannelInput,
  EditChannelInput,
  PostChannelMessageInput,
  UpdateChannelMemberInput,
} from "@channels/model";
import { channelQueries, type ChannelQueryData } from "@channels/queries";
import { applyWorkspaceEvent } from "@workspace/sync";
import {
  bookmarkChannelMessage,
  createChannel,
  createChannelMember,
  deleteChannel,
  deleteChannelRoutine,
  editChannel,
  markChannelRead,
  postChannelMessage,
  removeChannelArtifact,
  removeChannelMember,
  runChannelRoutine,
  updateChannelMember,
} from "@channels/server/functions";

export const channelMutations = {
  create: () =>
    mutationOptions({
      mutationFn: (input: CreateChannelInput) => createChannel({ data: input }),
      onSuccess: (_channel, _input, _result, { client }) => channelQueries.list.refresh(client),
    }),
  createMember: () =>
    mutationOptions({
      mutationFn: (input: CreateChannelMemberInput) => createChannelMember({ data: input }),
    }),
  updateMember: () =>
    mutationOptions({
      mutationFn: (input: UpdateChannelMemberInput) => updateChannelMember({ data: input }),
    }),
  edit: () =>
    mutationOptions({
      mutationFn: (input: EditChannelInput) => editChannel({ data: input }),
      onSuccess: (_channel, _input, _result, { client }) => channelQueries.list.refresh(client),
    }),
  delete: (channelId: string) =>
    mutationOptions({
      mutationFn: () => deleteChannel({ data: { channelId } }),
      onSuccess: (_deleted, _variables, _result, { client }) => {
        applyWorkspaceEvent(client, { type: "channel.deleted", channelId });
      },
    }),
  removeMember: (agentId: string) =>
    mutationOptions({
      mutationFn: () => removeChannelMember({ data: { agentId } }),
    }),
  runRoutine: (channelId: string) =>
    mutationOptions({
      mutationFn: (routineId: string) => runChannelRoutine({ data: { channelId, routineId } }),
    }),
  deleteRoutine: (channelId: string) =>
    mutationOptions({
      mutationFn: (routineId: string) => deleteChannelRoutine({ data: { channelId, routineId } }),
    }),
  removeArtifact: (channelId: string) =>
    mutationOptions({
      mutationFn: (artifactId: string) =>
        removeChannelArtifact({ data: { channelId, artifactId } }),
    }),
  markRead: () =>
    mutationOptions({
      mutationFn: (input: { channelId: string; sequence: number }) =>
        markChannelRead({ data: input }),
    }),
  bookmark: () =>
    mutationOptions({
      mutationFn: (input: BookmarkChannelMessageInput) => bookmarkChannelMessage({ data: input }),
    }),
  post: () =>
    mutationOptions({
      mutationFn: (input: PostChannelMessageInput) => postChannelMessage({ data: input }),
      // A pending post follows the transcript until its echo replaces it by ID. A failure
      // removes only this copy, never the echo.
      onMutate: ({ channelId, id, content, attachments }, { client }) => {
        const { queryKey } = channelQueries.detail(channelId);
        const state = client.getQueryData<ChannelQueryData | null>(queryKey);
        if (!state) return;
        const pending: ChannelConversationMessage = {
          id,
          sequence: (state.messages.at(-1)?.sequence ?? 0) + 1,
          sender: { type: "user" },
          content,
          ...(attachments
            ? {
                attachments: attachments.map(({ mimeType, base64 }, index) => ({
                  name: `Image ${index + 1}`,
                  url: `data:${mimeType};base64,${base64}`,
                  mimeType,
                })),
              }
            : {}),
          timestamp: new Date().toISOString(),
        };
        client.setQueryData<ChannelQueryData>(queryKey, {
          ...state,
          messages: [...state.messages, pending],
        });
        return pending;
      },
      onError: (_error, { channelId }, sent, { client }) =>
        client.setQueryData<ChannelQueryData | null>(
          channelQueries.detail(channelId).queryKey,
          (state) =>
            state && { ...state, messages: state.messages.filter((message) => message !== sent) },
        ),
    }),
};
