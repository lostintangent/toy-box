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
import { getSessionActivity } from "@sessions/server/state/activity";
import { getStateDatabase } from "@/server/database";
import { getProcessValue } from "@/shared/server/processState";
import { ChannelDatabase } from "./database";
import { subscribeToChannel } from "./stream";

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
    const channels = new ChannelDatabase(await getStateDatabase());
    const current = await channels.getChannel(channel.id);
    if (!channelNotificationIsCurrent(current, kind, message.sequence) || !current) return;
    const agents = [channelLead(channel.id), ...(await channels.listMembers(channel.id))];
    return channelNotification(kind, current, message, agents);
  });
}

/** The stream bootstraps a full snapshot, then retains only metadata and roster. */
export function startChannelPush(): VoidFunction {
  lifecycle.stop?.();
  const subscriptions = new Map<string, VoidFunction>();
  const refreshBadge = () =>
    void publishBadge(["requests", "completions"], async () => {
      const channels = new ChannelDatabase(await getStateDatabase());
      return channelBadgeCount((await channels.listChannels()).channels);
    });
  const unsubscribeBadge = subscribeWorkspaceEvents((event) => {
    if (event.type === "channel.upserted" || event.type === "channel.deleted") refreshBadge();
  });
  refreshBadge();
  const unobserve = observeTopics((topic, active) => {
    if (!topic.startsWith("channel:")) return;
    subscriptions.get(topic)?.();
    subscriptions.delete(topic);
    if (!active) return;
    let state: ChannelState | undefined;
    let healthy = true,
      ended = false;
    const update = (value: ChannelActivityState) =>
      void publish(topic, {
        type: "update",
        value,
        attention: value.waitingRequestSequence,
        ending: !!value.ending,
        dismissImmediately: ended,
        render: (at, limit) =>
          healthy || ended ? channelActivityContent(value, at, limit) : undefined,
      });
    const unsubscribe = subscribeToChannel(
      topic.slice("channel:".length),
      (event) => {
        if (event.type === "deleted") {
          ended = true;
          return update({
            workingAgents: [],
            tasksDone: 0,
            tasksTotal: 0,
            ending: "channelDeleted",
          });
        }
        const previous = state ?? (event.type === "snapshot" ? event.state : undefined);
        if (!previous) return;
        state = { ...reduceChannelState(previous, event), messages: [] };
        update(channelActivityState(state, isRunning));
      },
      () => {
        healthy = false;
      },
    );
    // A roster agent's activity can change who is working; Push drops unchanged values.
    const unsubscribeActivity = subscribeWorkspaceEvents((event) => {
      if (
        !ended &&
        state &&
        "sessionId" in event &&
        [state.lead, ...state.members].some(({ id }) => id === event.sessionId)
      )
        update(channelActivityState(state, isRunning));
    });
    subscriptions.set(topic, () => {
      unsubscribe();
      unsubscribeActivity();
    });
  });
  const stop = () => {
    unsubscribeBadge();
    unobserve();
    for (const unsubscribe of subscriptions.values()) unsubscribe();
    subscriptions.clear();
    if (lifecycle.stop === stop) delete lifecycle.stop;
  };
  lifecycle.stop = stop;
  return stop;
}

const isRunning = (agentId: string) => getSessionActivity(agentId)?.status === "running";
