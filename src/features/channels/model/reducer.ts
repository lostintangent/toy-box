import { isChannelSystemMessage } from ".";
import type { ChannelArtifact, ChannelEvent, ChannelMessage, ChannelState } from ".";
import { workspaceFileId } from "@files/model";

/** Apply one ordered detail event to the current Channel state. */
export function reduceChannelState(state: ChannelState, event: ChannelEvent): ChannelState {
  if (event.revision <= state.revision) return state;

  if (event.type === "state") {
    const firstStateSequence = event.state.messages[0]?.sequence;
    const lastCachedSequence = state.messages.at(-1)?.sequence;
    if (
      firstStateSequence !== undefined &&
      lastCachedSequence !== undefined &&
      lastCachedSequence < firstStateSequence - 1
    ) {
      return event.state;
    }
    const messages = mergeChannelMessages(event.state.messages, state.messages);
    return messages === event.state.messages ? event.state : { ...event.state, messages };
  }

  const next = { ...state, revision: event.revision };
  switch (event.type) {
    case "message": {
      next.messages = upsertMessage(state.messages, event.message);
      if (!isChannelSystemMessage(event.message)) return next;

      const content = event.message.content;
      switch (content.type) {
        case "member_joined":
          next.members = [
            ...state.members.filter(({ sessionId }) => sessionId !== content.member.sessionId),
            content.member,
          ];
          break;

        case "member_left":
          next.members = state.members.filter(
            ({ sessionId }) => sessionId !== content.member.sessionId,
          );
          break;

        case "artifact_shared":
          next.artifacts = upsertArtifact(state.artifacts, content.artifact);
          break;
      }
      return next;
    }

    case "reaction":
      next.messages = state.messages.map((message) => {
        if (message.sequence !== event.sequence || isChannelSystemMessage(message)) return message;

        const reactions = [
          ...(message.reactions ?? []).filter(({ agentId }) => agentId !== event.agentId),
          ...(event.reaction ? [{ agentId: event.agentId, reaction: event.reaction }] : []),
        ];
        return {
          ...message,
          reactions: reactions.length ? reactions : undefined,
        };
      });
      return next;

    case "status":
      next.members = state.members.map((member) =>
        member.sessionId === event.sessionId ? { ...member, status: event.status } : member,
      );
      return next;
  }
}

/** Merge messages into the ordered transcript without replacing cached values. */
export function mergeChannelMessages(
  messages: ChannelMessage[],
  incoming: readonly ChannelMessage[],
): ChannelMessage[] {
  const messageIds = new Set(messages.map(({ id }) => id));
  const additions = incoming.filter(({ id }) => !messageIds.has(id));
  if (additions.length === 0) return messages;
  return [...messages, ...additions].sort((left, right) => left.sequence - right.sequence);
}

function upsertMessage(messages: ChannelMessage[], message: ChannelMessage): ChannelMessage[] {
  const next = messages.filter(({ id }) => id !== message.id);
  const index = next.findIndex(({ sequence }) => sequence >= message.sequence);
  if (index === -1) return [...next, message];
  return [...next.slice(0, index), message, ...next.slice(index)];
}

function upsertArtifact(
  artifacts: readonly ChannelArtifact[],
  artifact: ChannelArtifact,
): ChannelArtifact[] {
  const id = workspaceFileId(artifact.file);
  const index = artifacts.findIndex(({ file }) => workspaceFileId(file) === id);
  if (index === -1) return [...artifacts, artifact];
  return [...artifacts.slice(0, index), artifact, ...artifacts.slice(index + 1)];
}
