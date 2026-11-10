import type { WorkspaceEvents } from "@workspace/model/events";
import type { ChannelList } from ".";

/** The catalog's transition function for every client. Channels stay newest first, and members
 *  carry only their identity. */
export function reduceChannelList(
  list: ChannelList,
  event: WorkspaceEvents["channels"],
): ChannelList {
  switch (event.type) {
    case "channel.upserted": {
      const channels = list.channels.filter(({ id }) => id !== event.channel.id);
      channels.push(event.channel);
      return {
        ...list,
        channels: channels.sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
        ),
      };
    }
    case "channel.deleted":
      return {
        channels: list.channels.filter(({ id }) => id !== event.channelId),
        members: list.members.filter((member) => member.channelId !== event.channelId),
      };
    case "channel.member.upserted":
      return {
        ...list,
        members: list.members.some(({ id }) => id === event.member.id)
          ? list.members.map((member) => (member.id === event.member.id ? event.member : member))
          : [event.member, ...list.members],
      };
    case "channel.member.deleted":
      return { ...list, members: list.members.filter(({ id }) => id !== event.agentId) };
  }
}
