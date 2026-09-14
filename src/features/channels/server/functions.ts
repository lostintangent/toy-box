import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import type { Channel, ChannelList, ChannelMessage, ChannelState } from "@channels/model";
import {
  channelIdentitySchema,
  createChannelInputSchema,
  markChannelReadInputSchema,
  postChannelMessageInputSchema,
  removeChannelMemberInputSchema,
  renameChannelInputSchema,
} from "@channels/model";
import * as channels from ".";

export const listChannels = createServerFn({ method: "GET" }).handler(
  (): Promise<ChannelList> => channels.listChannels(),
);

export const getChannelState = createServerFn({ method: "GET" })
  .validator(zodValidator(channelIdentitySchema))
  .handler(({ data }): Promise<ChannelState> => channels.getChannelState(data.channelId));

export const listChannelMessagesBefore = createServerFn({ method: "GET" })
  .validator(
    zodValidator(channelIdentitySchema.extend({ beforeSequence: z.number().int().positive() })),
  )
  .handler(
    ({ data }): Promise<ChannelMessage[]> =>
      channels.listChannelMessagesBefore(data.channelId, data.beforeSequence),
  );

export const createChannel = createServerFn({ method: "POST" })
  .validator(zodValidator(createChannelInputSchema))
  .handler(({ data }): Promise<Channel> => channels.createChannel(data));

export const renameChannel = createServerFn({ method: "POST" })
  .validator(zodValidator(renameChannelInputSchema))
  .handler(({ data }): Promise<Channel> => channels.renameChannel(data));

export const deleteChannel = createServerFn({ method: "POST" })
  .validator(zodValidator(channelIdentitySchema))
  .handler(({ data }): Promise<boolean> => channels.deleteChannel(data.channelId));

export const removeChannelMember = createServerFn({ method: "POST" })
  .validator(zodValidator(removeChannelMemberInputSchema))
  .handler(({ data }): Promise<void> => channels.removeChannelMember(data.sessionId));

export const markChannelRead = createServerFn({ method: "POST" })
  .validator(zodValidator(markChannelReadInputSchema))
  .handler(({ data }): Promise<void> => channels.markChannelRead(data.channelId, data.sequence));

export const postChannelMessage = createServerFn({ method: "POST" })
  .validator(zodValidator(postChannelMessageInputSchema))
  .handler(({ data }): Promise<ChannelMessage> => channels.postChannelMessage(data));
