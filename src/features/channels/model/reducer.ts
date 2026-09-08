import type { ChannelEvent, ChannelMessage, ChannelSnapshot } from ".";
import { workspaceFileId } from "@files/model";

/** Apply one ordered detail event to the canonical Channel snapshot. */
export function reduceChannelSnapshot(
  snapshot: ChannelSnapshot,
  event: ChannelEvent,
): ChannelSnapshot {
  if (event.cursor <= snapshot.cursor) return snapshot;

  switch (event.type) {
    case "snapshot": {
      const messageIds = new Set(event.snapshot.messages.map(({ id }) => id));
      const localMessages = snapshot.messages.filter(({ id }) => !messageIds.has(id));
      return localMessages.length === 0
        ? event.snapshot
        : { ...event.snapshot, messages: [...event.snapshot.messages, ...localMessages] };
    }
    case "message":
      return {
        ...snapshot,
        cursor: event.cursor,
        messages: upsertMessage(snapshot.messages, event.message),
      };
    case "reaction":
      return {
        ...snapshot,
        cursor: event.cursor,
        messages: snapshot.messages.map((message) =>
          message.sequence !== event.sequence
            ? message
            : {
                ...message,
                reactions: [
                  ...message.reactions.filter(({ agentId }) => agentId !== event.agentId),
                  ...(event.reaction ? [{ agentId: event.agentId, reaction: event.reaction }] : []),
                ],
              },
        ),
      };
    case "member_added":
      return {
        ...snapshot,
        cursor: event.cursor,
        members: [...snapshot.members, event.member],
      };
    case "member_removed":
      return {
        ...snapshot,
        cursor: event.cursor,
        members: snapshot.members.filter(({ sessionId }) => sessionId !== event.sessionId),
      };
    case "artifact": {
      const artifactId = workspaceFileId(event.artifact.file);
      const index = snapshot.artifacts.findIndex(
        ({ file }) => workspaceFileId(file) === artifactId,
      );
      const artifacts = [...snapshot.artifacts];
      if (index === -1) artifacts.push(event.artifact);
      else artifacts[index] = event.artifact;
      return {
        ...snapshot,
        cursor: event.cursor,
        artifacts,
      };
    }
  }
}

function upsertMessage(messages: ChannelMessage[], message: ChannelMessage): ChannelMessage[] {
  const next = messages.filter(({ id }) => id !== message.id);
  const index = next.findIndex(({ sequence }) => sequence >= message.sequence);
  if (index === -1) return [...next, message];
  return [...next.slice(0, index), message, ...next.slice(index)];
}
