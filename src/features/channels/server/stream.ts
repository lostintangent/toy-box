import {
  CHANNEL_LEAD_PROFILE,
  type ChannelCatalog,
  type ChannelState,
  type ChannelObservationEvent,
} from "@channels/model";
import { channelAgentPresence } from "@channels/model/presence";
import { reduceChannelRoster } from "@channels/model/reducer";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import type { WorkspaceEvent, WorkspaceEvents } from "@workspace/model/events";
import { getSessionActivity } from "@sessions/server/state/activity";
import { getStateDatabase } from "@/server/database";
import { ChannelDatabase } from "./database";
import { replayChannelEvents, subscribeChannelEvents } from "./events";

type Roster = Pick<ChannelState, "lead" | "members">;

/**
 * Bootstrap once, then forward ordered changes without rereading durable state. The bootstrap
 * read's continuation subscribes with no I/O or timer between, so every later commit publishes
 * after it and live events continue its revision. Any other revision means that order broke, so
 * the stream closes.
 */
export function streamChannel(
  channelId: string,
  send: (event: ChannelObservationEvent) => void,
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

  function follow(revision: number, roster: Roster, presence: ChannelState["presence"]) {
    const live = { revision, roster, presence };
    const unsubscribeDetail = subscribeChannelEvents(channelId, (event) => {
      if (stopped) return;
      if (event.revision !== live.revision + 1) {
        stop();
        return close();
      }
      const previousRoster = live.roster;
      live.revision = event.revision;
      live.roster = reduceChannelRoster(previousRoster, event);
      send(event);
      if (live.roster !== previousRoster) publishPresence();
    });
    const unsubscribeWorkspace = subscribeWorkspaceEvents((event) => {
      if (event.type === "channel.deleted" && event.channelId === channelId) {
        deleted();
      } else if (
        (event.type === "session.running" ||
          event.type === "session.waiting" ||
          event.type === "session.background" ||
          event.type === "session.idle" ||
          event.type === "session.unread" ||
          event.type === "session.deleted") &&
        Object.hasOwn(live.presence, event.sessionId)
      ) {
        publishPresence();
      }
    });
    unsubscribe = () => {
      unsubscribeDetail();
      unsubscribeWorkspace();
    };

    function publishPresence() {
      const next = currentPresence(live.roster);
      const changed = Object.fromEntries(
        Object.entries(next).filter(([id, value]) => !Bun.deepEquals(live.presence[id], value)),
      );
      live.presence = next;
      if (Object.keys(changed).length) send({ type: "presence", presence: changed });
    }
  }

  async function establish() {
    if (afterRevision !== undefined) {
      const roster = await new ChannelDatabase(await getStateDatabase()).getRoster(channelId);
      if (stopped) return;
      if (!roster) return deleted();
      const replay = replayChannelEvents(channelId, afterRevision, roster.revision);
      if (replay) {
        const presence = currentPresence(roster);
        follow(roster.revision, roster, presence);
        for (const event of replay) send(event);
        return send({ type: "resumed", presence });
      }
    }
    const snapshot = await getChannelSnapshot(channelId);
    if (stopped) return;
    if (!snapshot) return deleted();
    follow(
      snapshot.revision,
      { lead: snapshot.lead, members: snapshot.members },
      snapshot.presence,
    );
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

/** Reads one atomic durable view, enriched with public presence. */
export async function getChannelSnapshot(channelId: string): Promise<ChannelState | null> {
  const snapshot = await new ChannelDatabase(await getStateDatabase()).getSnapshot(channelId, 100);
  return snapshot && { ...snapshot, presence: currentPresence(snapshot) };
}

function currentPresence({ lead, members }: Roster): ChannelState["presence"] {
  return Object.fromEntries(
    [lead, ...members].map((agent) => [
      agent.id,
      channelAgentPresence(agent, getSessionActivity(agent.id)?.status === "running"),
    ]),
  );
}

export type ChannelCatalogEvent =
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
export async function streamChannelCatalog(
  send: (event: ChannelCatalogEvent) => void,
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
