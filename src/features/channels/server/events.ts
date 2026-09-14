import type { ChannelEvent } from "@channels/model";
import { sharedMap } from "@/shared/server/processState";

const MAX_REPLAY_EVENTS = 500;
const channels = sharedMap<{
  history: ChannelEvent[];
  listeners: Set<(event: ChannelEvent) => void>;
}>("channel-events");

/** Publish one committed Channel transition to its open clients. */
export function publishChannelEvent(channelId: string, event: ChannelEvent): void {
  const events = getChannelEvents(channelId);
  events.history.push(event);
  if (events.history.length > MAX_REPLAY_EVENTS) {
    events.history.splice(0, events.history.length - MAX_REPLAY_EVENTS);
  }
  for (const listener of [...events.listeners]) listener(event);
}

/** Return a complete contiguous replay, or undefined when a state event is required. */
export function replayChannelEvents(
  channelId: string,
  afterRevision: number,
  throughRevision: number,
): ChannelEvent[] | undefined {
  if (afterRevision === throughRevision) return [];
  if (afterRevision > throughRevision) return undefined;
  const replay = getChannelEvents(channelId).history.filter(
    ({ revision }) => revision > afterRevision && revision <= throughRevision,
  );
  return replay.length === throughRevision - afterRevision &&
    replay.every(({ revision }, index) => revision === afterRevision + index + 1)
    ? replay
    : undefined;
}

export function subscribeChannelEvents(
  channelId: string,
  listener: (event: ChannelEvent) => void,
): () => void {
  const events = getChannelEvents(channelId);
  events.listeners.add(listener);
  return () => events.listeners.delete(listener);
}

export function releaseChannelEvents(channelId: string): void {
  channels.delete(channelId);
}

function getChannelEvents(channelId: string) {
  let events = channels.get(channelId);
  if (!events) {
    events = { history: [], listeners: new Set() };
    channels.set(channelId, events);
  }
  return events;
}
