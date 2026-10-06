import { mutationOptions } from "@tanstack/react-query";
import type {
  CreateChannelMemberInput,
  CreateChannelInput,
  EditChannelInput,
  PostChannelMessageInput,
  UpdateChannelMemberInput,
} from "@channels/model";
import { channelQueries, type ChannelQueryData } from "@channels/queries";
import { reduceChannelState } from "@channels/model/reducer";
import { applyChannelListEvent, invalidateChannelListQuery } from "@channels/queryCache";
import {
  createChannel,
  createChannelMember,
  deleteChannel,
  deleteChannelRoutine,
  editChannel,
  markChannelRead,
  postChannelMessage,
  removeChannelMember,
  runChannelRoutine,
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
  runRoutine: (channelId: string) =>
    mutationOptions({
      mutationFn: (routineId: string) => runChannelRoutine({ data: { channelId, routineId } }),
    }),
  deleteRoutine: (channelId: string) =>
    mutationOptions({
      mutationFn: (routineId: string) => deleteChannelRoutine({ data: { channelId, routineId } }),
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
        client.setQueryData<ChannelQueryData | null>(
          channelQueries.detail(input.channelId).queryKey,
          (state) =>
            state && {
              ...state,
              ...reduceChannelState(state, {
                type: "message",
                message: {
                  id: input.id,
                  sender: { type: "user" },
                  content: input.content,
                  ...(input.attachments ? { attachments: input.attachments } : {}),
                  timestamp: new Date().toISOString(),
                },
              }),
            },
        );
      },
    }),
};
