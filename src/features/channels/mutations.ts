import { mutationOptions } from "@tanstack/react-query";
import type {
  ChannelState,
  CreateChannelMemberInput,
  CreateChannelInput,
  EditChannelInput,
  PostChannelMessageInput,
  UpdateChannelMemberInput,
} from "@channels/model";
import { channelQueries } from "@channels/queries";
import { applyChannelListEvent, invalidateChannelListQuery } from "@channels/queryCache";
import {
  createChannel,
  createChannelMember,
  deleteChannel,
  editChannel,
  markChannelRead,
  postChannelMessage,
  removeChannelMember,
  updateChannelMember,
} from "@channels/server/functions";

export const channelMutations = {
  create: () =>
    mutationOptions({
      mutationFn: (input: CreateChannelInput) => createChannel({ data: input }),
      onSuccess: (_channel, _input, _result, { client }) => invalidateChannelListQuery(client),
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
      onSuccess: (_channel, _input, _result, { client }) => invalidateChannelListQuery(client),
    }),
  delete: (channelId: string) =>
    mutationOptions({
      mutationFn: () => deleteChannel({ data: { channelId } }),
      onSuccess: (_deleted, _variables, _result, { client }) => {
        applyChannelListEvent(client, { type: "channel.deleted", channelId });
      },
    }),
  removeMember: (agentId: string) =>
    mutationOptions({
      mutationFn: () => removeChannelMember({ data: { agentId } }),
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
        client.setQueryData<ChannelState>(
          channelQueries.detail(input.channelId).queryKey,
          (state) => {
            if (!state || state.messages.some(({ id }) => id === input.id)) return state;
            return {
              ...state,
              messages: [
                ...state.messages,
                {
                  id: input.id,
                  sequence: (state.messages.at(-1)?.sequence ?? 0) + 1,
                  sender: { type: "user" },
                  content: input.content,
                  ...(input.attachments ? { attachments: input.attachments } : {}),
                  timestamp: new Date().toISOString(),
                },
              ],
            };
          },
        );
      },
    }),
};
