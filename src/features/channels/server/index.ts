import { basename, isAbsolute, resolve } from "node:path";
import {
  agentHandleFromName,
  type Agent,
  type AgentMembership,
  type AgentMention,
} from "@agents/model";
import { getAgent, listAgents } from "@agents/server";
import { resolveAgentMembership } from "@agents/server/runtime";
import { mentionAgent } from "@agents/server/supervisor";
import type {
  Channel,
  ChannelArtifact,
  ChannelEvent,
  ChannelList,
  ChannelMember,
  ChannelMessage,
  ChannelMessageSender,
  ChannelReaction,
  ChannelSnapshot,
  CreateChannelInput,
  PostChannelMessageInput,
  RenameChannelInput,
} from "@channels/model";
import { resolveChannelAudience } from "@channels/model";
import { resolveWorkspaceFile, workspaceFileFromAbsolutePath } from "@files/server/paths";
import {
  deleteSessionIfExists,
  readSessionContext,
  waitForSession,
} from "@sessions/server/runtime";
import { getStateDatabase } from "@/server/database";
import { broadcast } from "@workspace/server/events";
import { ChannelDatabase } from "./database";
import {
  publishChannelEvent,
  releaseChannelEvents,
  replayChannelEvents,
  subscribeChannelEvents,
} from "./events";

type ChannelAgentContext = {
  channel: Channel;
  member: ChannelMember;
  agent: Agent;
};

export async function listChannels(): Promise<ChannelList> {
  return new ChannelDatabase(await getStateDatabase()).listChannels();
}

export async function getChannel(channelId: string): Promise<ChannelSnapshot> {
  const snapshot = await new ChannelDatabase(await getStateDatabase()).getSnapshot(channelId);
  if (!snapshot) throw new Error("Channel not found.");
  return snapshot;
}

/** Replay one Channel from a cursor, then continue with committed detail events. */
export async function streamChannel(
  channelId: string,
  afterCursor: number,
  onEvent: (event: ChannelEvent) => void,
): Promise<VoidFunction> {
  let cursor = afterCursor;
  let catchingUp = true;
  const bufferedEvents: ChannelEvent[] = [];

  const emit = (event: ChannelEvent) => {
    if (event.cursor <= cursor) return;
    cursor = event.cursor;
    onEvent(event);
  };
  const flush = () => {
    bufferedEvents.sort((left, right) => left.cursor - right.cursor);
    while (bufferedEvents.length > 0) {
      const event = bufferedEvents[0]!;
      if (event.cursor <= cursor) {
        bufferedEvents.shift();
      } else if (event.cursor === cursor + 1) {
        bufferedEvents.shift();
        emit(event);
      } else {
        return;
      }
    }
  };
  const unsubscribe = subscribeChannelEvents(channelId, (event) => {
    bufferedEvents.push(event);
    if (!catchingUp) flush();
  });
  try {
    const snapshot = await getChannel(channelId);
    const replay = replayChannelEvents(channelId, afterCursor, snapshot.cursor);
    if (replay) {
      for (const event of replay) emit(event);
    } else {
      emit({ type: "snapshot", cursor: snapshot.cursor, snapshot });
    }
    catchingUp = false;
    flush();
    return unsubscribe;
  } catch (error) {
    unsubscribe();
    throw error;
  }
}

export async function createChannel(input: CreateChannelInput): Promise<Channel> {
  const channel = await new ChannelDatabase(await getStateDatabase()).createChannel(input);
  broadcast({ type: "channel.upserted", channel });
  return channel;
}

export async function renameChannel(input: RenameChannelInput): Promise<Channel> {
  const database = new ChannelDatabase(await getStateDatabase());
  const channel = await database.renameChannel(input);
  if (!channel) throw new Error("Channel not found.");
  broadcast({ type: "channel.upserted", channel });
  return channel;
}

export async function deleteChannel(channelId: string): Promise<boolean> {
  const database = new ChannelDatabase(await getStateDatabase());
  for (const sessionId of await database.listMemberSessionIds(channelId)) {
    await deleteSessionIfExists(sessionId);
  }
  if (!(await database.deleteChannel(channelId))) return false;
  releaseChannelEvents(channelId);
  broadcast({ type: "channel.deleted", channelId });
  return true;
}

export async function removeChannelMember(channelId: string, sessionId: string): Promise<void> {
  const member = await new ChannelDatabase(await getStateDatabase()).getMemberBySession(sessionId);
  if (member?.host.channelId !== channelId) return;
  await deleteSessionIfExists(sessionId);
}

export async function markChannelRead(channelId: string, sequence: number): Promise<void> {
  const channel = await new ChannelDatabase(await getStateDatabase()).markUserSeen(
    channelId,
    sequence,
  );
  if (channel) broadcast({ type: "channel.upserted", channel });
}

export function postChannelMessage(input: PostChannelMessageInput): Promise<ChannelMessage> {
  return postMessage({
    ...input,
    sender: { type: "user" },
    senderName: "You",
  });
}

export async function postChannelMessageFromSession(
  sessionId: string,
  input: Omit<PostChannelMessageInput, "attachments"> & {
    attachmentPaths?: readonly string[];
  },
): Promise<ChannelMessage> {
  const database = new ChannelDatabase(await getStateDatabase());
  const channel = await database.getChannel(input.channelId);
  if (!channel) throw new Error("Channel not found.");
  const { attachmentPaths, ...message } = input;
  return postChannelMessage({
    ...message,
    attachments: await loadAttachments(sessionId, channel.directory, attachmentPaths),
  });
}

export async function readChannelForSession(channelId: string, afterSequence = 0) {
  const database = new ChannelDatabase(await getStateDatabase());
  const channel = await database.getChannel(channelId);
  if (!channel) throw new Error("Channel not found.");
  return readChannel(database, channel, afterSequence);
}

export async function listJoinedChannelsForAgent(sessionId: string): Promise<Channel[]> {
  const agentId = await requireSessionAgentId(sessionId);
  return new ChannelDatabase(await getStateDatabase()).listAgentChannels(agentId);
}

export async function readJoinedChannelForAgent(
  sessionId: string,
  channelId: string,
  afterSequence = 0,
) {
  const database = new ChannelDatabase(await getStateDatabase());
  const { channel } = await requireJoinedChannel(database, sessionId, channelId);
  return readChannel(database, channel, afterSequence);
}

export async function continueAgentInChannel(
  sessionId: string,
  channelId: string,
  content: string,
) {
  const database = new ChannelDatabase(await getStateDatabase());
  const { channel, member } = await requireJoinedChannel(database, sessionId, channelId);
  await mentionAgent({
    host: member.host,
    agentId: member.agentId,
    message: { systemMessage: { type: "agent_handoff", content } },
    directory: channel.directory,
    hostLabel: channel.title,
  });
  return waitForSession(member.sessionId);
}

export async function readChannelForAgent(sessionId: string) {
  const database = new ChannelDatabase(await getStateDatabase());
  const context = await requireChannelAgentContext(database, sessionId);
  const result = await readChannel(database, context.channel, context.member.seenThrough);
  const seenThrough = result.messages.at(-1)?.sequence ?? context.member.seenThrough;
  await database.markMemberSeen(context.member, seenThrough);
  return result;
}

async function readChannel(database: ChannelDatabase, channel: Channel, afterSequence: number) {
  const messages = await database.listMessages(channel.id, afterSequence, 100);
  const readThrough = messages.at(-1)?.sequence ?? afterSequence;
  const [members, agents, artifacts] = await Promise.all([
    database.listMembers(channel.id),
    listAgents(),
    database.listArtifacts(channel.id),
  ]);
  const memberAgentIds = new Set(members.map(({ agentId }) => agentId));
  return {
    members: agents.filter(({ id }) => memberAgentIds.has(id)).map(publicChannelMember),
    messages,
    artifacts: artifacts.map(publicChannelArtifact),
    hasMore: readThrough < channel.latestSequence,
  };
}

async function requireSessionAgentId(sessionId: string): Promise<string> {
  const resolved = await resolveAgentMembership(sessionId);
  if (resolved?.membership.host.kind !== "session") {
    throw new Error("This Agent does not belong to a Session host.");
  }
  return resolved.agent.id;
}

async function requireJoinedChannel(
  database: ChannelDatabase,
  sessionId: string,
  channelId: string,
) {
  const agentId = await requireSessionAgentId(sessionId);
  const [channel, members] = await Promise.all([
    database.getChannel(channelId),
    database.listMembers(channelId),
  ]);
  if (!channel) throw new Error("Channel not found.");
  const member = members.find((member) => member.agentId === agentId);
  if (!member) throw new Error("This Agent is not a member of this Channel.");
  return { channel, member };
}

/** Public roster facts intentionally omit every member's private session and unread cursor. */
function publicChannelMember(agent: Agent) {
  return {
    agentId: agent.id,
    name: agent.name,
    mention: `@${agentHandleFromName(agent.name)}`,
    persona: agent.persona,
  };
}

function publicChannelArtifact(artifact: ChannelArtifact) {
  return {
    path: resolveWorkspaceFile(artifact.file)!,
    title: artifact.title,
  };
}

export async function sendChannelMessageFromAgent(
  sessionId: string,
  input: {
    content: string;
    attachmentPaths?: readonly string[];
    agentMentions?: readonly AgentMention[];
  },
): Promise<ChannelMessage> {
  const { channel, member, agent } = await requireChannelAgentContext(
    new ChannelDatabase(await getStateDatabase()),
    sessionId,
  );
  return postMessage({
    id: crypto.randomUUID(),
    channelId: channel.id,
    sender: {
      type: "agent",
      agentId: member.agentId,
    },
    senderName: agent.name,
    content: input.content,
    attachments: await loadAttachments(sessionId, channel.directory, input.attachmentPaths),
    agentMentions: input.agentMentions,
  });
}

export async function setChannelMessageReactionFromAgent(
  sessionId: string,
  input: { sequence: number; reaction: ChannelReaction["reaction"] | null },
): Promise<ChannelReaction["reaction"] | null> {
  const database = new ChannelDatabase(await getStateDatabase());
  const { channel, member } = await requireChannelAgentContext(database, sessionId);
  const change = await database.setMessageReaction({
    channelId: channel.id,
    sequence: input.sequence,
    agentId: member.agentId,
    reaction: input.reaction,
  });
  if (!change) return null;
  const reaction = change.reaction?.reaction ?? null;
  publishChannelEvent(channel.id, {
    type: "reaction",
    cursor: change.cursor,
    sequence: input.sequence,
    agentId: member.agentId,
    reaction,
  });
  return reaction;
}

async function loadAttachments(
  sessionId: string,
  channelDirectory: string | undefined,
  paths: readonly string[] | undefined,
) {
  if (!paths?.length) return undefined;
  const directory = (await readSessionContext(sessionId))?.workingDirectory ?? channelDirectory;
  return Promise.all(
    paths.map(async (path) => {
      const absolutePath = isAbsolute(path) ? path : directory && resolve(directory, path);
      if (!absolutePath)
        throw new Error("Use an absolute attachment path in a Channel without a directory.");
      const file = Bun.file(absolutePath);
      if (!(await file.exists()) || !file.type.startsWith("image/")) {
        throw new Error(`Channel attachment is not an image file: ${path}`);
      }
      return {
        displayName: basename(absolutePath),
        mimeType: file.type,
        base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      };
    }),
  );
}

/** Persist once, then apply the same audience plan for user and Agent senders. */
async function postMessage({
  id,
  channelId,
  sender,
  senderName,
  content,
  attachments,
  agentMentions,
}: {
  id: string;
  channelId: string;
  sender: Exclude<ChannelMessageSender, { type: "system" }>;
  senderName: string;
  content: string;
  attachments?: PostChannelMessageInput["attachments"];
  agentMentions?: readonly AgentMention[];
}): Promise<ChannelMessage> {
  const database = new ChannelDatabase(await getStateDatabase());
  const [channel, members, agents] = await Promise.all([
    database.getChannel(channelId),
    database.listMembers(channelId),
    content.includes("@") || agentMentions?.length ? listAgents() : [],
  ]);
  if (!channel) throw new Error("Channel not found.");
  const audience = resolveChannelAudience({
    content,
    sender,
    members,
    agents,
    agentMentions,
  });
  const message = await appendMessage(database, {
    id,
    channelId,
    sender,
    content,
    attachments,
  });

  const wake = (agentId: string, initialExecutionMode?: AgentMention["initialExecutionMode"]) =>
    mentionAgent({
      host: { kind: "channel", channelId },
      agentId,
      initialExecutionMode,
      message: { systemMessage: { type: "channel_message", senderName } },
      directory: channel.directory,
      hostLabel: channel.title,
    });
  void deliverChannelMessage(database, channelId, audience, agentMentions, wake).catch((error) => {
    console.error("Failed to deliver Channel message:", error);
  });
  return message;
}

/** Atomically admit the shared Channel projection before announcing its current Agent identity. */
export async function admitChannelAgent(agent: Agent, membership: AgentMembership): Promise<void> {
  if (membership.host.kind !== "channel") {
    throw new Error("Channel Agent host received a non-Channel membership.");
  }

  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.createMember({
    channelId: membership.host.channelId,
    agentId: membership.agentId,
    sessionId: membership.sessionId,
    executionMode: membership.executionMode,
  });

  publishChannelEvent(membership.host.channelId, {
    type: "member_added",
    cursor: change.cursor,
    member: change.member,
  });

  await appendMessage(database, {
    id: crypto.randomUUID(),
    channelId: membership.host.channelId,
    sender: { type: "system" },
    content: `${agent.name} joined the channel`,
  });
}

async function deliverChannelMessage(
  database: ChannelDatabase,
  channelId: string,
  audience: ReturnType<typeof resolveChannelAudience>,
  agentMentions: readonly AgentMention[] | undefined,
  wake: (
    agentId: string,
    initialExecutionMode?: AgentMention["initialExecutionMode"],
  ) => Promise<void>,
): Promise<void> {
  for (const member of audience.members) {
    void wake(member.agentId).catch((error) => {
      console.error(`Failed to wake Channel Agent ${member.sessionId}:`, error);
    });
  }
  const initialModes = new Map(
    agentMentions?.map(({ agentId, initialExecutionMode }) => [agentId, initialExecutionMode]),
  );
  const invitations = await Promise.allSettled(
    audience.invitations.map((agent) => wake(agent.id, initialModes.get(agent.id))),
  );
  for (const [index, invitation] of invitations.entries()) {
    if (invitation.status !== "rejected") continue;
    console.error("Failed to invite a channel agent from an @mention:", invitation.reason);
    const agent = audience.invitations[index]!;
    await appendMessage(database, {
      id: crypto.randomUUID(),
      channelId,
      sender: { type: "system" },
      content: `Could not invite ${agent.name}: ${errorMessage(invitation.reason)}`,
    });
  }
}

export async function shareChannelArtifactFromAgent(
  sessionId: string,
  input: { path: string; title: string },
) {
  const database = new ChannelDatabase(await getStateDatabase());
  const context = await requireChannelAgentContext(database, sessionId);
  const workspaceDirectory =
    (await readSessionContext(sessionId))?.workingDirectory ?? context.channel.directory;
  return shareChannelArtifact(database, context.channel.id, workspaceDirectory, input);
}

export async function shareChannelArtifactFromSession(
  sessionId: string,
  input: { channelId: string; path: string; title: string },
) {
  const database = new ChannelDatabase(await getStateDatabase());
  const channel = await database.getChannel(input.channelId);
  if (!channel) throw new Error("Channel not found.");
  const workspaceDirectory =
    (await readSessionContext(sessionId))?.workingDirectory ?? channel.directory;
  return shareChannelArtifact(database, channel.id, workspaceDirectory, input);
}

async function shareChannelArtifact(
  database: ChannelDatabase,
  channelId: string,
  workspaceDirectory: string | undefined,
  input: { path: string; title: string },
) {
  const path = input.path.trim();
  const absolutePath = isAbsolute(path)
    ? resolve(path)
    : workspaceDirectory
      ? resolve(workspaceDirectory, path)
      : undefined;
  if (!absolutePath || !(await Bun.file(absolutePath).exists())) {
    throw new Error("Share an existing file using an absolute or workspace-relative path.");
  }
  const change = await database.upsertArtifact({
    channelId,
    file: workspaceFileFromAbsolutePath(absolutePath),
    title: input.title,
  });
  publishChannelEvent(channelId, {
    type: "artifact",
    cursor: change.cursor,
    artifact: change.artifact,
  });
  broadcast({ type: "channel.upserted", channel: change.channel });
  return publicChannelArtifact(change.artifact);
}

export async function detachChannelAgentSession(
  agent: Agent,
  membership: AgentMembership,
): Promise<void> {
  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.deleteMemberBySession(membership.sessionId);
  if (change) {
    const channelId = change.member.host.channelId;
    publishChannelEvent(channelId, {
      type: "member_removed",
      cursor: change.cursor,
      sessionId: membership.sessionId,
    });
    if (await database.getChannel(channelId)) {
      await appendMessage(database, {
        id: crypto.randomUUID(),
        channelId,
        sender: { type: "system" },
        content: `${agent.name} left the channel`,
      });
    }
  }
}

async function requireChannelAgentContext(
  database: ChannelDatabase,
  sessionId: string,
): Promise<ChannelAgentContext> {
  const member = await database.getMemberBySession(sessionId);
  if (!member) throw new Error("This agent session does not belong to a channel.");
  const [channel, agent] = await Promise.all([
    database.getChannel(member.host.channelId),
    getAgent(member.agentId),
  ]);
  if (!channel || !agent) throw new Error("This agent session does not belong to a channel.");
  return { channel, member, agent };
}

async function appendMessage(
  database: ChannelDatabase,
  input: Parameters<ChannelDatabase["appendMessage"]>[0],
): Promise<ChannelMessage> {
  const change = await database.appendMessage(input);
  publishChannelEvent(input.channelId, {
    type: "message",
    cursor: change.cursor,
    message: change.message,
  });
  broadcast({ type: "channel.upserted", channel: change.channel });
  return change.message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The invitation failed.";
}
