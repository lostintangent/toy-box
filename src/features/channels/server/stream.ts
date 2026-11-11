import {
  CHANNEL_LEAD_PROFILE,
  type ChannelCatalog,
  type ChannelState,
  type ChannelSubscriptionEvent,
} from "@channels/model";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import type { WorkspaceEvent, WorkspaceEvents } from "@workspace/model/events";
import { getSessionActivity } from "@sessions/server/state/activity";
import { getStateDatabase } from "@/server/database";
import { ChannelDatabase } from "./database";
import { replayChannelEvents, subscribeChannelEvents } from "./eventLog";

/**
 * Bootstrap once, then forward ordered changes without rereading durable state. The bootstrap
 * read's continuation subscribes with no I/O or timer between, so every later commit publishes
 * after it and live events continue its revision. Any other revision means that order broke, so
 * the stream closes.
 */
export function subscribeToChannel(
  channelId: string,
  send: (event: ChannelSubscriptionEvent) => void,
  close: VoidFunction,
  afterRevision?: number,
): VoidFunction {
  let stopped = false;
  let unsubscribe: VoidFunction | undefined;

  function stop() {
    if (stopped) return;
    stopped = true;
    unsubscribe?.();
  }

  function deleted() {
    if (stopped) return;
    stop();
    send({ type: "deleted", channelId });
    close();
  }

  function subscribeAfter(revision: number) {
    let live = revision;
    const unsubscribeDetail = subscribeChannelEvents(channelId, (event) => {
      if (stopped) return;
      if (event.revision !== live + 1) {
        stop();
        return close();
      }
      live = event.revision;
      send(event);
    });
    const unsubscribeWorkspace = subscribeWorkspaceEvents((event) => {
      if (event.type === "channel.deleted" && event.channelId === channelId) deleted();
    });
    unsubscribe = () => {
      unsubscribeDetail();
      unsubscribeWorkspace();
    };
  }

  async function establish() {
    if (afterRevision !== undefined) {
      const roster = await new ChannelDatabase(await getStateDatabase()).getRoster(channelId);
      if (stopped) return;
      if (!roster) return deleted();
      const replay = replayChannelEvents(channelId, afterRevision, roster.revision);
      if (replay) {
        subscribeAfter(roster.revision);
        for (const event of replay) send(event);
        return send({ type: "resumed" });
      }
    }
    const snapshot = await getChannelSnapshot(channelId);
    if (stopped) return;
    if (!snapshot) return deleted();
    subscribeAfter(snapshot.revision);
    send({ type: "snapshot", state: snapshot });
  }

  establish().catch((error) => {
    if (stopped) return;
    console.error(`Failed to stream Channel ${channelId}:`, error);
    stop();
    close();
  });
  return stop;
}

/** Reads one atomic durable view. */
export async function getChannelSnapshot(channelId: string): Promise<ChannelState | null> {
  return new ChannelDatabase(await getStateDatabase()).getSnapshot(channelId, 100);
}

export type ChannelCatalogSubscriptionEvent =
  | { type: "snapshot"; catalog: ChannelCatalog }
  | { type: "working"; working: string[] }
  | WorkspaceEvents["channels"];

/** The catalog as JSON; the catalog stream opens with the same value. */
export async function getChannelCatalog(): Promise<ChannelCatalog> {
  const list = await new ChannelDatabase(await getStateDatabase()).listChannels();
  return {
    ...list,
    lead: CHANNEL_LEAD_PROFILE,
    working: runningAgentIds([...list.channels, ...list.members].map(({ id }) => id)),
  };
}

/** Opens with the catalog, then forwards Channel changes in commit order and reports who is
 *  working. It subscribes in the read's continuation with no I/O or timer between, so no change
 *  is missed or repeated. */
export async function subscribeToChannelCatalog(
  send: (event: ChannelCatalogSubscriptionEvent) => void,
): Promise<VoidFunction> {
  const catalog = await getChannelCatalog();
  const agents = new Map([
    ...catalog.channels.map(({ id }) => [id, id] as const),
    ...catalog.members.map(({ id, channelId }) => [id, channelId] as const),
  ]);
  let working = catalog.working;

  function apply(event: WorkspaceEvent) {
    switch (event.type) {
      case "channel.upserted":
        agents.set(event.channel.id, event.channel.id);
        return forward(event);
      case "channel.deleted":
        for (const [agentId, channelId] of agents) {
          if (channelId === event.channelId) agents.delete(agentId);
        }
        return forward(event);
      case "channel.member.upserted":
        agents.set(event.member.id, event.member.channelId);
        return forward(event);
      case "channel.member.deleted":
        agents.delete(event.agentId);
        return forward(event);
      default:
        if (event.type.startsWith("session.")) publishWorking();
    }
  }

  function forward(event: WorkspaceEvents["channels"]) {
    send(event);
    publishWorking();
  }

  function publishWorking() {
    const next = runningAgentIds(agents.keys());
    if (Bun.deepEquals(next, working)) return;
    working = next;
    send({ type: "working", working });
  }

  send({ type: "snapshot", catalog });
  return subscribeWorkspaceEvents(apply);
}

/** Sorted, so the same set always compares equal. */
function runningAgentIds(agentIds: Iterable<string>): string[] {
  return [...agentIds].filter((id) => getSessionActivity(id)?.status === "running").sort();
}
