import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import type { Channel, ChannelList, ChannelMessage } from "@channels/model";
import {
  channelIdentitySchema,
  createChannelMemberInputSchema,
  createChannelInputSchema,
  editChannelInputSchema,
  markChannelReadInputSchema,
  postChannelMessageInputSchema,
  removeChannelMemberInputSchema,
  channelRoutineIdentitySchema,
  updateChannelMemberInputSchema,
} from "@channels/model";
import * as channels from ".";
export const listChannels = createServerFn({ method: "GET" }).handler((): Promise<ChannelList> =>
  channels.listChannels(),
);

export const createChannel = createServerFn({ method: "POST" })
  .validator(zodValidator(createChannelInputSchema))
  .handler(({ data }): Promise<Channel> => channels.createChannel(data));

export const createChannelMember = createServerFn({ method: "POST" })
  .validator(zodValidator(createChannelMemberInputSchema))
  .handler(({ data }) => channels.createChannelMember(data));

export const updateChannelMember = createServerFn({ method: "POST" })
  .validator(zodValidator(updateChannelMemberInputSchema))
  .handler(({ data }) => channels.updateChannelMember(data));

export const editChannel = createServerFn({ method: "POST" })
  .validator(zodValidator(editChannelInputSchema))
  .handler(({ data }): Promise<Channel> => channels.editChannel(data));

export const deleteChannel = createServerFn({ method: "POST" })
  .validator(zodValidator(channelIdentitySchema))
  .handler(({ data }): Promise<boolean> => channels.deleteChannel(data.channelId));

export const removeChannelMember = createServerFn({ method: "POST" })
  .validator(zodValidator(removeChannelMemberInputSchema))
  .handler(({ data }): Promise<void> => channels.removeChannelMember(data.agentId));

export const deleteChannelRoutine = createServerFn({ method: "POST" })
  .validator(zodValidator(channelRoutineIdentitySchema))
  .handler(({ data }): Promise<boolean> =>
    channels.deleteChannelRoutine(data.channelId, data.routineId),
  );

export const runChannelRoutine = createServerFn({ method: "POST" })
  .validator(zodValidator(channelRoutineIdentitySchema))
  .handler(({ data }): Promise<boolean> =>
    channels.runChannelRoutine(data.channelId, data.routineId),
  );

export const markChannelRead = createServerFn({ method: "POST" })
  .validator(zodValidator(markChannelReadInputSchema))
  .handler(async ({ data }): Promise<void> => {
    await channels.markChannelRead(data.channelId, data.sequence);
  });

export const postChannelMessage = createServerFn({ method: "POST" })
  .validator(zodValidator(postChannelMessageInputSchema))
  .handler(({ data }): Promise<ChannelMessage> => channels.postChannelMessage(data));
