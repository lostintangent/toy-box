import {
  type ChannelState,
  type ChannelEvent,
  type ChannelObservationEvent,
} from "@channels/model";
import { channelAgentPresence } from "@channels/model/presence";
import { reduceChannelRoster } from "@channels/model/reducer";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { getSessionState } from "@workspace/server/state/sessions";
import { getStateDatabase } from "@/server/database";
import { resolveArtifactResources, resolveMessageResources } from "./resources";
import { ChannelDatabase } from "./database";
import { replayChannelEvents, subscribeChannelEvents } from "./events";

type Roster = Pick<ChannelState, "lead" | "members">;

/** Bootstrap once, then forward ordered changes without rereading durable state. */
export function streamChannel(
  channelId: string,
  send: (event: ChannelObservationEvent) => void,
  close: VoidFunction,
  afterRevision?: number,
): VoidFunction {
  let stopped = false;
  let catchingUp = false;
  let publishedRevision = 0;
  let live: { revision: number; roster: Roster; presence: ChannelState["presence"] } | undefined;
  const unsubscribeDetail = subscribeChannelEvents(channelId, (event) => {
    if (stopped || event.revision <= (live?.revision ?? afterRevision ?? -1)) return;
    publishedRevision = Math.max(publishedRevision, event.revision);
    if (live && !catchingUp && event.revision === live.revision + 1) forward(event);
    else scheduleCatchUp();
  });
  const unsubscribeWorkspace = subscribeWorkspaceEvents((event) => {
    if (event.type === "channel.deleted" && event.channelId === channelId) {
      deleted();
    } else if (
      live &&
      (event.type === "session.running" ||
        event.type === "session.waiting" ||
        event.type === "session.idle" ||
        event.type === "session.unread" ||
        event.type === "session.deleted") &&
      Object.hasOwn(live.presence, event.sessionId)
    ) {
      publishPresence();
    }
  });

  function stop() {
    if (stopped) return;
    stopped = true;
    unsubscribeDetail();
    unsubscribeWorkspace();
  }

  function deleted() {
    if (stopped) return;
    stop();
    send({ type: "deleted", channelId });
    close();
  }

  function publishPresence() {
    const current = live!;
    const next = currentPresence(current.roster);
    const changed = Object.fromEntries(
      Object.entries(next).filter(([id, value]) => !Bun.deepEquals(current.presence[id], value)),
    );
    current.presence = next;
    if (Object.keys(changed).length) send({ type: "presence", presence: changed });
  }

  function forward(event: ChannelEvent) {
    const current = live!;
    const previousRoster = current.roster;
    current.revision = event.revision;
    current.roster = reduceChannelRoster(previousRoster, event);
    send(event);
    if (current.roster !== previousRoster) publishPresence();
  }

  function scheduleCatchUp() {
    if (stopped || catchingUp) return;
    catchingUp = true;
    queueMicrotask(() => void catchUp());
  }

  async function establish(cursor?: number) {
    if (stopped) return;
    if (cursor !== undefined) {
      const database = await getStateDatabase({ createIfMissing: false });
      const roster = database && (await new ChannelDatabase(database).getRoster(channelId));
      if (stopped) return;
      if (!roster) return deleted();
      const replay = replayChannelEvents(channelId, cursor, roster.revision);
      if (replay) {
        for (const event of replay) send(event);
        live = { revision: roster.revision, roster, presence: currentPresence(roster) };
        send({ type: "resumed", presence: live.presence });
        return;
      }
    }
    const snapshot = await getChannelSnapshot(channelId);
    if (stopped) return;
    if (!snapshot) return deleted();
    live = {
      revision: snapshot.revision,
      roster: { lead: snapshot.lead, members: snapshot.members },
      presence: snapshot.presence,
    };
    send({ type: "snapshot", state: snapshot });
  }

  async function catchUp() {
    try {
      if (!live) await establish(afterRevision);
      while (!stopped && live && live.revision < publishedRevision) {
        const replay = replayChannelEvents(channelId, live.revision, publishedRevision);
        if (replay) {
          for (const event of replay) forward(event);
        } else {
          await establish();
        }
      }
    } catch (error) {
      if (stopped) return;
      console.error(`Failed to stream Channel ${channelId}:`, error);
      stop();
      close();
    } finally {
      catchingUp = false;
    }
  }

  scheduleCatchUp();
  return stop;
}

/** Reads one atomic durable view, enriched with public presence and resource URLs. */
export async function getChannelSnapshot(channelId: string): Promise<ChannelState | null> {
  const database = await getStateDatabase({ createIfMissing: false });
  if (!database) return null;
  const snapshot = await new ChannelDatabase(database).getSnapshot(channelId, 100);
  if (!snapshot) return null;
  const { request } = snapshot;
  return {
    ...snapshot,
    request: request ? resolveMessageResources(request) : null,
    presence: currentPresence(snapshot),
    messages: snapshot.messages.map(resolveMessageResources),
    artifacts: snapshot.artifacts.map(resolveArtifactResources),
  };
}

function currentPresence({ lead, members }: Roster): ChannelState["presence"] {
  return Object.fromEntries(
    [lead, ...members].map((agent) => [
      agent.id,
      channelAgentPresence(agent, getSessionState(agent.id)?.status === "running"),
    ]),
  );
}
