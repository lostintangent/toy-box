import { compareChannelAgents, isChannelSystemMessage, unlinkChannelTasks } from ".";
import type {
  Channel,
  ChannelArtifact,
  ChannelEvent,
  ChannelMessage,
  ChannelSubscriptionEvent,
  ChannelRoutine,
  ChannelState,
} from ".";
import { workspaceFileId } from "@files/model";

export function reduceChannelState(
  previous: ChannelState,
  event: Exclude<ChannelSubscriptionEvent, { type: "deleted" }>,
): ChannelState {
  if (event.type === "snapshot") return event.state;
  if (event.type === "resumed" || event.revision <= previous.revision) return previous;
  const state = {
    ...reduceChannelRoster(previous, event),
    channel: reduceChannel(previous.channel, event),
    revision: event.revision,
  };
  if (event.type === "bookmarks") {
    state.bookmarks = event.bookmarks;
  } else if (event.type === "reaction") {
    state.messages = state.messages.map((message) => reduceChannelReaction(message, event));
    if (state.request) state.request = reduceChannelReaction(state.request, event);
  } else if (event.type === "message") {
    const { message } = event;
    state.messages = upsertMessage(state.messages, keepSentImages(state.messages, message));
    const content = isChannelSystemMessage(message) ? message.content : undefined;
    switch (content?.type) {
      case "artifact_shared":
        state.artifacts = shareArtifact(state.artifacts, content.artifact, message.timestamp);
        break;
      case "routine_scheduled":
      case "routine_edited":
        state.routines = setRoutine(state.routines, content.routine);
        break;
      case "routine_deleted":
        state.routines = state.routines.filter(({ id }) => id !== content.routine.id);
        break;
      case "artifact_removed": {
        const id = workspaceFileId(content.artifact.file);
        state.artifacts = state.artifacts.filter((artifact) => artifact.id !== id);
        break;
      }
    }
  }
  if (state.channel.requestSequence !== previous.channel.requestSequence) {
    state.request =
      event.type === "message" && !isChannelSystemMessage(event.message) && event.message.request
        ? event.message
        : null;
  }
  return state;
}

/** Metadata and attention changes expressed by committed Channel events. */
export function reduceChannel(channel: Channel, event: ChannelEvent): Channel {
  switch (event.type) {
    case "tasks":
      return { ...channel, tasks: event.tasks };
    case "model":
      return { ...channel, model: event.model, updatedAt: event.updatedAt };
    case "read":
      return { ...channel, seenThrough: event.seenThrough };
    case "message": {
      const { message } = event;
      const next = {
        ...channel,
        latestSequence: Math.max(channel.latestSequence, message.sequence),
        updatedAt: message.timestamp,
      };
      if (!isChannelSystemMessage(message)) {
        if (message.sender.type === "user") {
          // Sending reads the Channel, wherever you send from, as opening it would.
          return {
            ...next,
            requestSequence: null,
            seenThrough: Math.max(channel.seenThrough, message.sequence),
          };
        }
        return message.request ? { ...next, requestSequence: message.sequence } : next;
      }
      const content = message.content;
      switch (content.type) {
        case "channel_renamed":
          return { ...next, name: content.name };
        case "channel_avatar_changed":
          return { ...next, avatar: content.avatar };
        case "channel_purpose_changed":
          return { ...next, purpose: content.purpose ?? undefined };
        case "channel_directory_changed":
          return { ...next, directory: content.directory ?? undefined };
        case "preview_changed":
          return { ...next, preview: content.preview ?? undefined };
        case "member_left":
          return {
            ...next,
            tasks: unlinkChannelTasks(channel.tasks, "ownerId", content.member.id),
          };
        case "artifact_removed":
          return {
            ...next,
            tasks: unlinkChannelTasks(
              channel.tasks,
              "artifactId",
              workspaceFileId(content.artifact.file),
            ),
          };
        case "tasks_completed":
          return { ...next, completedSequence: message.sequence };
        default:
          return next;
      }
    }
    default:
      return channel;
  }
}

function reduceChannelRoster<Roster extends Pick<ChannelState, "lead" | "members">>(
  roster: Roster,
  event: ChannelEvent,
): Roster {
  if (event.type === "status") {
    return roster.lead.id === event.agentId
      ? { ...roster, lead: { ...roster.lead, status: event.status } }
      : {
          ...roster,
          members: roster.members.map((member) =>
            member.id === event.agentId ? { ...member, status: event.status } : member,
          ),
        };
  }
  const content =
    event.type === "message" && isChannelSystemMessage(event.message)
      ? event.message.content
      : undefined;
  const member =
    event.type === "member"
      ? event.member
      : content?.type === "member_joined"
        ? content.member
        : undefined;
  if (member) {
    return {
      ...roster,
      members: [...roster.members.filter(({ id }) => id !== member.id), member].sort(
        compareChannelAgents,
      ),
    };
  }
  if (content?.type === "member_left") {
    return { ...roster, members: roster.members.filter(({ id }) => id !== content.member.id) };
  }
  return roster;
}

/** Updates a loaded message or the separately retained pending request with the same reaction. */
function reduceChannelReaction<Message extends ChannelMessage>(
  message: Message,
  event: Extract<ChannelEvent, { type: "reaction" }>,
): Message {
  if (message.sequence !== event.sequence || isChannelSystemMessage(message)) return message;
  const reactions = [
    ...(message.reactions ?? []).filter(({ agentId }) => agentId !== event.agentId),
    ...(event.reaction ? [{ agentId: event.agentId, reaction: event.reaction }] : []),
  ];
  return { ...message, reactions: reactions.length ? reactions : undefined };
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

/** An echo keeps the local image bytes its sender shows, so sending doesn't refetch them. */
function keepSentImages(messages: ChannelMessage[], message: ChannelMessage): ChannelMessage {
  const sent = message.attachments && messages.find(({ id }) => id === message.id)?.attachments;
  if (!sent || isChannelSystemMessage(message)) return message;
  const attachments = message.attachments?.map((attachment, index) =>
    sent[index]?.url.startsWith("data:") ? { ...attachment, url: sent[index].url } : attachment,
  );
  return { ...message, attachments };
}

/** Adds a routine, or changes one in place so the list keeps its order. */
function setRoutine(
  routines: readonly ChannelRoutine[],
  routine: ChannelRoutine,
): ChannelRoutine[] {
  return routines.some(({ id }) => id === routine.id)
    ? routines.map((current) => (current.id === routine.id ? routine : current))
    : [...routines, routine];
}

/** Retitling a shared artifact preserves its original share time. */
function shareArtifact(
  artifacts: readonly ChannelArtifact[],
  incoming: Omit<ChannelArtifact, "id" | "sharedAt">,
  sharedAt: string,
): ChannelArtifact[] {
  const id = workspaceFileId(incoming.file);
  return artifacts.some((artifact) => artifact.id === id)
    ? artifacts.map((artifact) => (artifact.id === id ? { ...artifact, ...incoming } : artifact))
    : [...artifacts, { ...incoming, id, sharedAt }];
}
