import {
  agentHandleFromName,
  channelStatus,
  isChannelSystemMessage,
  type Channel,
  type ChannelAgent,
  type ChannelMessage,
  type ChannelState,
} from ".";
import type { AgentAvatar } from "./agent";
import type { NotificationEvent } from "@push/model";
import { notificationCompletionBody, notificationRequestBody } from "./notificationText";
export type ChannelNotificationKind = "request" | "completion";
export type ChannelActivityState = {
  workingAgents: { id: string; name: string; avatar?: AgentAvatar }[];
  tasksDone: number;
  tasksTotal: number;
  waitingRequestSequence?: number;
  ending?: "completed" | "channelDeleted" | "tasksRemoved";
};

/** Matches ChannelKit: direct-root progress, intrinsic lead first, and actual public presence. */
export function channelActivityState(
  state: Pick<ChannelState, "lead" | "members" | "presence"> & {
    channel: Pick<Channel, "tasks" | "requestSequence">;
  },
): ChannelActivityState {
  const tasksTotal = state.channel.tasks.length;
  const tasksDone = state.channel.tasks.filter((task) => task.status === "done").length;
  return {
    workingAgents: [state.lead, ...state.members]
      .filter((agent) => state.presence[agent.id]?.state === "working")
      .map(({ id, name, avatar }) => ({ id, name, ...(avatar ? { avatar } : {}) })),
    tasksDone,
    tasksTotal,
    ...(state.channel.requestSequence === null
      ? {}
      : { waitingRequestSequence: state.channel.requestSequence }),
    ...(tasksTotal === 0 || tasksDone === tasksTotal
      ? { ending: tasksTotal === 0 ? "tasksRemoved" : "completed" }
      : {}),
  };
}

export function channelNotification(
  kind: ChannelNotificationKind,
  channel: Channel,
  message: ChannelMessage,
  agents: readonly ChannelAgent[],
): NotificationEvent {
  let body: string;
  if (kind === "completion") body = notificationCompletionBody(channel.tasks);
  else {
    if (isChannelSystemMessage(message))
      throw new Error("A request alert needs a conversation message.");
    body = notificationRequestBody(message, agents);
  }
  const sender = message.sender;
  const requester =
    sender.type === "agent" ? agents.find((agent) => agent.id === sender.agentId) : undefined;
  return {
    type: "notification",
    key: `${channel.id}:${kind}`,
    title: channel.name,
    body,
    category: kind,
    threadID: channel.id,
    data: {
      kind,
      channelID: channel.id,
      sequence: message.sequence,
      ...(kind === "request" && requester ? { handle: agentHandleFromName(requester.name) } : {}),
    },
  };
}

export function channelBadgeCount(channels: readonly Channel[]): number {
  return channels.filter((channel) => channelStatus(channel) === "waiting").length;
}

export function channelActivityContent(
  state: ChannelActivityState,
  timestamp: number,
  byteLimit: number,
) {
  let content = { ...state, updatedAt: timestamp };
  if (Buffer.byteLength(JSON.stringify(content)) > byteLimit)
    content = {
      ...content,
      workingAgents: state.workingAgents.map(({ id, name }) => ({ id, name })),
    };
  return content;
}

export function channelNotificationIsCurrent(
  channel: Channel | null,
  kind: ChannelNotificationKind,
  sequence: number,
): boolean {
  return (
    channel !== null &&
    sequence > channel.seenThrough &&
    (kind === "request" ? channel.requestSequence : channel.completedSequence) === sequence
  );
}
