import { mutationOptions } from "@tanstack/react-query";
import type { ChannelSnapshot, CreateChannelInput, PostChannelMessageInput } from "@channels/model";
import { channelQueries } from "@channels/queries";
import { applyChannelListEvent } from "@channels/queryCache";
import {
  createChannel,
  deleteChannel,
  markChannelRead,
  postChannelMessage,
  removeChannelMember,
  renameChannel,
} from "@channels/server/functions";

export const channelMutations = {
  create: () =>
    mutationOptions({
      mutationFn: (input: CreateChannelInput) => createChannel({ data: input }),
      onSuccess: (channel, _input, _result, { client }) =>
        applyChannelListEvent(client, { type: "channel.upserted", channel }),
    }),
  rename: (channelId: string) =>
    mutationOptions({
      mutationFn: (title: string) => renameChannel({ data: { channelId, title } }),
      onSuccess: (channel, _title, _result, { client }) =>
        applyChannelListEvent(client, { type: "channel.upserted", channel }),
    }),
  delete: (channelId: string) =>
    mutationOptions({
      mutationFn: () => deleteChannel({ data: { channelId } }),
      onSuccess: (_deleted, _variables, _result, { client }) => {
        applyChannelListEvent(client, { type: "channel.deleted", channelId });
      },
    }),
  removeMember: (channelId: string, sessionId: string) =>
    mutationOptions({
      mutationFn: () => removeChannelMember({ data: { channelId, sessionId } }),
    }),
  markRead: () =>
    mutationOptions({
      mutationFn: (input: { channelId: string; sequence: number }) =>
        markChannelRead({ data: input }),
    }),
  post: () =>
    mutationOptions({
      mutationFn: (input: PostChannelMessageInput) => postChannelMessage({ data: input }),
      onMutate: (input, { client }) => {
        client.setQueryData<ChannelSnapshot>(
          channelQueries.detail(input.channelId).queryKey,
          (snapshot) => {
            if (!snapshot || snapshot.messages.some(({ id }) => id === input.id)) return snapshot;
            return {
              ...snapshot,
              messages: [
                ...snapshot.messages,
                {
                  id: input.id,
                  sequence: (snapshot.messages.at(-1)?.sequence ?? 0) + 1,
                  sender: { type: "user" },
                  content: input.content,
                  ...(input.attachments ? { attachments: input.attachments } : {}),
                  reactions: [],
                  timestamp: new Date().toISOString(),
                },
              ],
            };
          },
        );
      },
    }),
};
