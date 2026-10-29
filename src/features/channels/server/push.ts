import type { Channel, ChannelMessage, ChannelState } from "@channels/model";
import { channelLead, isChannelSystemMessage } from "@channels/model";
import { reduceChannelState } from "@channels/model/reducer";
import {
  channelActivityContent,
  channelActivityState,
  channelNotification,
  channelNotificationIsCurrent,
  channelBadgeCount,
  type ChannelActivityState,
  type ChannelNotificationKind,
} from "@channels/model/push";
import { observeTopics, publish, publishBadge } from "@push/server";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { getStateDatabase } from "@/server/database";
import { getProcessValue } from "@/shared/server/processState";
import { ChannelDatabase } from "./database";
import { streamChannel } from "./stream";

const lifecycle = getProcessValue<{ stop?: VoidFunction }>("channels.push", () => ({}));

export function publishChannelNotification(channel: Channel, message: ChannelMessage): void {
  const kind: ChannelNotificationKind | undefined = isChannelSystemMessage(message)
    ? message.content.type === "tasks_completed"
      ? "completion"
      : undefined
    : message.request
      ? "request"
      : undefined;
  if (!kind) return;
  void publish(`${kind}s`, async () => {
    // TODO: replace this wait with client presence reporting.
    await Bun.sleep(3000);
    const db = await getStateDatabase({ createIfMissing: false });
    if (!db) return;
    const channels = new ChannelDatabase(db);
    const current = await channels.getChannel(channel.id);
    if (!channelNotificationIsCurrent(current, kind, message.sequence) || !current) return;
    const agents = [channelLead(channel.id), ...(await channels.listMembers(channel.id))];
    return channelNotification(kind, current, message, agents);
  });
}

/** The stream bootstraps a full snapshot, then retains only metadata, roster and presence. */
export function startChannelPush(): VoidFunction {
  lifecycle.stop?.();
  const streams = new Map<string, VoidFunction>();
  const refreshBadge = () =>
    void publishBadge(["requests", "completions"], async () => {
      const db = await getStateDatabase({ createIfMissing: false });
      if (!db) return;
      return channelBadgeCount((await new ChannelDatabase(db).listChannels()).channels);
    });
  const unsubscribeBadge = subscribeWorkspaceEvents((event) => {
    if (event.type === "channel.upserted" || event.type === "channel.deleted") refreshBadge();
  });
  refreshBadge();
  const unobserve = observeTopics((topic, active) => {
    if (!topic.startsWith("channel:")) return;
    streams.get(topic)?.();
    streams.delete(topic);
    if (!active) return;
    let state: ChannelState | undefined;
    let healthy = true,
      ended = false;
    streams.set(
      topic,
      streamChannel(
        topic.slice("channel:".length),
        (event) => {
          let value: ChannelActivityState;
          if (event.type === "deleted") {
            ended = true;
            value = {
              workingAgents: [],
              tasksDone: 0,
              tasksTotal: 0,
              ending: "channelDeleted",
            };
          } else {
            const previous = state ?? (event.type === "snapshot" ? event.state : undefined);
            if (!previous) return;
            state = { ...reduceChannelState(previous, event), messages: [] };
            value = channelActivityState(state);
          }
          void publish(topic, {
            type: "update",
            value,
            attention: value.waitingRequestSequence,
            ending: !!value.ending,
            dismissImmediately: ended,
            render: (at, limit) =>
              healthy || ended ? channelActivityContent(value, at, limit) : undefined,
          });
        },
        () => {
          healthy = false;
        },
      ),
    );
  });
  const stop = () => {
    unsubscribeBadge();
    unobserve();
    for (const close of streams.values()) close();
    streams.clear();
    if (lifecycle.stop === stop) delete lifecycle.stop;
  };
  lifecycle.stop = stop;
  return stop;
}
