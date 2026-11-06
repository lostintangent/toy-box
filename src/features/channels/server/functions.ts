import { createServerFn } from "@tanstack/react-start";
import type { Channel, ChannelList, ChannelMessage } from "@channels/model";
import {
  bookmarkChannelMessageInputSchema,
  channelIdentitySchema,
  createChannelMemberInputSchema,
  createChannelInputSchema,
  editChannelInputSchema,
  markChannelReadInputSchema,
  postChannelMessageInputSchema,
  removeChannelMemberInputSchema,
  channelArtifactIdentitySchema,
  channelRoutineIdentitySchema,
  updateChannelMemberInputSchema,
} from "@channels/model";
import * as channels from ".";
export const listChannels = createServerFn({ method: "GET" }).handler((): Promise<ChannelList> =>
  channels.listChannels(),
);

export const createChannel = createServerFn({ method: "POST" })
  .validator(createChannelInputSchema)
  .handler(({ data }): Promise<Channel> => channels.createChannel(data));

export const createChannelMember = createServerFn({ method: "POST" })
  .validator(createChannelMemberInputSchema)
  .handler(({ data }) => channels.createChannelMember(data));

export const updateChannelMember = createServerFn({ method: "POST" })
  .validator(updateChannelMemberInputSchema)
  .handler(({ data }) => channels.updateChannelMember(data));

export const editChannel = createServerFn({ method: "POST" })
  .validator(editChannelInputSchema)
  .handler(({ data }): Promise<Channel> => channels.editChannel(data));

export const deleteChannel = createServerFn({ method: "POST" })
  .validator(channelIdentitySchema)
  .handler(({ data }): Promise<boolean> => channels.deleteChannel(data.channelId));

export const removeChannelMember = createServerFn({ method: "POST" })
  .validator(removeChannelMemberInputSchema)
  .handler(({ data }) => channels.removeChannelMember(data.agentId, { type: "user" }));

export const deleteChannelRoutine = createServerFn({ method: "POST" })
  .validator(channelRoutineIdentitySchema)
  .handler(({ data }): Promise<boolean> =>
    channels.deleteChannelRoutine(data.channelId, data.routineId),
  );

export const removeChannelArtifact = createServerFn({ method: "POST" })
  .validator(channelArtifactIdentitySchema)
  .handler(({ data }): Promise<boolean> =>
    channels.removeChannelArtifact(data.channelId, data.artifactId, { type: "user" }),
  );

export const runChannelRoutine = createServerFn({ method: "POST" })
  .validator(channelRoutineIdentitySchema)
  .handler(({ data }): Promise<boolean> =>
    channels.runChannelRoutine(data.channelId, data.routineId),
  );

export const markChannelRead = createServerFn({ method: "POST" })
  .validator(markChannelReadInputSchema)
  .handler(async ({ data }): Promise<void> => {
    await channels.markChannelRead(data.channelId, data.sequence);
  });

export const bookmarkChannelMessage = createServerFn({ method: "POST" })
  .validator(bookmarkChannelMessageInputSchema)
  .handler(({ data }): Promise<void> => channels.bookmarkChannelMessage(data));

export const postChannelMessage = createServerFn({ method: "POST" })
  .validator(postChannelMessageInputSchema)
  .handler(({ data }): Promise<ChannelMessage> => channels.postChannelMessage(data));
