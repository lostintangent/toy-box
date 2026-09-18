import { isAbsolute, resolve } from "node:path";
import { agentHandleFromName, type Agent, type AgentMembership } from "@agents/model";
import { listAgentProfiles } from "@agents/server";
import { mentionAgent } from "@agents/server/supervisor";
import type {
  Channel,
  ChannelAttachment,
  ChannelArtifact,
  ChannelEvent,
  ChannelList,
  ChannelMember,
  ChannelMemberStatus,
  ChannelMessage,
  ChannelMessageSender,
  ChannelReaction,
  ChannelState,
  CreateChannelInput,
  PostChannelMessageInput,
  RenameChannelInput,
  SetChannelStatusInput,
} from "@channels/model";
import { resolveChannelAudience } from "@channels/model";
import { resolveWorkspaceFile, workspaceFileFromAbsolutePath } from "@files/server/paths";
import { deleteSessionIfExists, getSessionDirectory } from "@sessions/server/runtime";
import { getStateDatabase } from "@/server/database";
import { broadcast } from "@workspace/server/events";
import { ChannelDatabase, type ChannelMemberRecord } from "./database";
import {
  publishChannelEvent,
  releaseChannelEvents,
  replayChannelEvents,
  subscribeChannelEvents,
} from "./events";

const CHANNEL_MESSAGE_LIMIT = 100;

export async function listChannels(): Promise<ChannelList> {
  return new ChannelDatabase(await getStateDatabase()).listChannels();
}

export async function getChannelState(channelId: string): Promise<ChannelState> {
  return requireChannelState(new ChannelDatabase(await getStateDatabase()), channelId);
}

export async function listChannelMessagesBefore(
  channelId: string,
  beforeSequence: number,
): Promise<ChannelMessage[]> {
  const database = new ChannelDatabase(await getStateDatabase());
  return database.listMessagesBefore(channelId, beforeSequence, CHANNEL_MESSAGE_LIMIT);
}

/** Replay one Channel after a revision, then continue with committed detail events. */
export async function streamChannel(
  channelId: string,
  afterRevision: number,
  onEvent: (event: ChannelEvent) => void,
): Promise<VoidFunction> {
  let revision = afterRevision;
  let catchingUp = true;
  const bufferedEvents: ChannelEvent[] = [];

  const emit = (event: ChannelEvent) => {
    if (event.revision <= revision) return;
    revision = event.revision;
    onEvent(event);
  };
  const flush = () => {
    bufferedEvents.sort((left, right) => left.revision - right.revision);
    while (bufferedEvents.length > 0) {
      const event = bufferedEvents[0]!;
      if (event.revision <= revision) {
        bufferedEvents.shift();
      } else if (event.revision === revision + 1) {
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
    const database = new ChannelDatabase(await getStateDatabase());
    const throughRevision = await database.getRevision(channelId);
    if (throughRevision === null) throw new Error("Channel not found.");
    const replay = replayChannelEvents(channelId, afterRevision, throughRevision);
    if (replay) {
      for (const event of replay) emit(event);
    } else {
      const state = await requireChannelState(database, channelId);
      emit({ type: "state", revision: state.revision, state });
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

export async function removeChannelMember(sessionId: string): Promise<void> {
  const member = await new ChannelDatabase(await getStateDatabase()).getMemberBySession(sessionId);
  if (!member) return;
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
  });
}

export async function postChannelMessageFromSession(
  sessionId: string,
  input: Omit<PostChannelMessageInput, "attachments"> & {
    attachmentPaths?: readonly string[];
  },
): Promise<ChannelMessage> {
  const { attachmentPaths, ...message } = input;
  return postMessage({
    ...message,
    sender: { type: "user" },
    attachments: await resolveAttachmentPaths(sessionId, attachmentPaths),
  });
}

export async function readChannelForSession(channelId: string, beforeSequence?: number) {
  const database = new ChannelDatabase(await getStateDatabase());
  const channel = await database.getChannel(channelId);
  if (!channel) throw new Error("Channel not found.");
  return readChannelBefore(database, channel, beforeSequence);
}

export async function readChannelForAgent(sessionId: string) {
  const database = new ChannelDatabase(await getStateDatabase());
  const member = await requireChannelMember(database, sessionId);
  const channel = await database.getChannel(member.host.channelId);
  if (!channel) throw new Error("Channel not found.");
  const messages = await database.listMessagesAfter(
    channel.id,
    member.seenThrough,
    CHANNEL_MESSAGE_LIMIT,
  );
  const readThrough = messages.at(-1)?.sequence ?? member.seenThrough;
  const result = await readChannel(
    database,
    channel,
    messages,
    readThrough < channel.latestSequence,
  );
  await database.markMemberSeen(member, readThrough);
  return result;
}

async function readChannelBefore(
  database: ChannelDatabase,
  channel: Channel,
  beforeSequence?: number,
) {
  const messages = await database.listMessagesBefore(
    channel.id,
    beforeSequence,
    CHANNEL_MESSAGE_LIMIT,
  );
  return readChannel(database, channel, messages, (messages[0]?.sequence ?? 1) > 1);
}

async function readChannel(
  database: ChannelDatabase,
  channel: Channel,
  messages: ChannelMessage[],
  hasMore: boolean,
) {
  const [members, agents, artifacts] = await Promise.all([
    database.listMembers(channel.id),
    listAgentProfiles(),
    database.listArtifacts(channel.id),
  ]);
  const membersByAgentId = new Map(members.map((member) => [member.agentId, member]));
  return {
    members: agents.flatMap((agent) => {
      const member = membersByAgentId.get(agent.id);
      return member ? [publicChannelMember(agent, member)] : [];
    }),
    messages,
    artifacts: artifacts.map(publicChannelArtifact),
    hasMore,
  };
}

async function requireChannelState(
  database: ChannelDatabase,
  channelId: string,
): Promise<ChannelState> {
  const state = await database.getState(channelId, CHANNEL_MESSAGE_LIMIT);
  if (!state) throw new Error("Channel not found.");
  return state;
}

/** Public membership facts intentionally omit every member's private session and read position. */
function publicChannelMember(agent: Pick<Agent, "id" | "name" | "persona">, member: ChannelMember) {
  return {
    agentId: agent.id,
    name: agent.name,
    mention: `@${agentHandleFromName(agent.name)}`,
    persona: agent.persona,
    ...(member.status ? { status: member.status } : {}),
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
  },
): Promise<ChannelMessage> {
  const member = await requireChannelMember(
    new ChannelDatabase(await getStateDatabase()),
    sessionId,
  );
  return postMessage({
    id: crypto.randomUUID(),
    channelId: member.host.channelId,
    sender: {
      type: "agent",
      agentId: member.agentId,
    },
    content: input.content,
    attachments: await resolveAttachmentPaths(sessionId, input.attachmentPaths),
  });
}

export async function setChannelMessageReactionFromAgent(
  sessionId: string,
  input: { sequence: number; reaction: ChannelReaction["reaction"] | null },
): Promise<ChannelReaction["reaction"] | null> {
  const database = new ChannelDatabase(await getStateDatabase());
  const member = await requireChannelMember(database, sessionId);
  return setChannelMemberReaction(database, member, input.sequence, input.reaction);
}

export async function setChannelAgentStatus(
  sessionId: string,
  input: SetChannelStatusInput,
): Promise<ChannelMemberStatus> {
  const database = new ChannelDatabase(await getStateDatabase());
  const member = await requireChannelMember(database, sessionId);
  const status: ChannelMemberStatus = {
    state: "working",
    text: input.status,
    ...(input.lookingAt ? { lookingAt: input.lookingAt } : {}),
    ...(input.workingOn ? { workingOn: input.workingOn } : {}),
  };
  await setChannelMemberStatus(database, member, status);
  return status;
}

export async function startChannelAgentTurn(membership: AgentMembership): Promise<void> {
  const database = new ChannelDatabase(await getStateDatabase());
  const member = await database.getMemberBySession(membership.sessionId);
  if (!member) return;
  const change = await database.clearWaitingMemberStatus(member);
  if (change) publishChannelStatus(member, change);
}

export async function finishChannelAgentTurn(
  membership: AgentMembership,
  waitingFor?: string,
): Promise<void> {
  const database = new ChannelDatabase(await getStateDatabase());
  const member = await database.getMemberBySession(membership.sessionId);
  if (!member) return;
  await setChannelMemberStatus(
    database,
    member,
    waitingFor ? { state: "waiting", text: waitingFor } : undefined,
  );
}

async function setChannelMemberReaction(
  database: ChannelDatabase,
  member: ChannelMember,
  sequence: number,
  reaction: ChannelReaction["reaction"] | null,
): Promise<ChannelReaction["reaction"] | null> {
  const channelId = member.host.channelId;
  const change = await database.setMessageReaction({
    channelId,
    sequence,
    agentId: member.agentId,
    reaction,
  });
  if (!change) return null;
  const currentReaction = change.reaction?.reaction ?? null;
  publishChannelEvent(channelId, {
    type: "reaction",
    revision: change.revision,
    sequence,
    agentId: member.agentId,
    reaction: currentReaction,
  });
  return currentReaction;
}

async function setChannelMemberStatus(
  database: ChannelDatabase,
  member: ChannelMember,
  status?: ChannelMemberStatus,
): Promise<void> {
  const change = await database.setMemberStatus(member, status);
  if (!change) return;
  publishChannelStatus(member, change);
}

function publishChannelStatus(
  member: ChannelMember,
  change: { revision: number; status?: ChannelMemberStatus },
): void {
  publishChannelEvent(member.host.channelId, {
    type: "status",
    revision: change.revision,
    sessionId: member.sessionId,
    ...(change.status ? { status: change.status } : {}),
  });
}

async function resolveAttachmentPaths(sessionId: string, paths: readonly string[] | undefined) {
  if (!paths?.length) return undefined;
  const directory = paths.some((path) => !isAbsolute(path))
    ? await getSessionDirectory(sessionId)
    : undefined;
  return Promise.all(
    paths.map(async (path) => {
      if (!isAbsolute(path) && !directory)
        throw new Error("Use an absolute attachment path when this Session has no workspace.");
      const absolutePath = resolve(directory ?? "", path);
      const file = Bun.file(absolutePath);
      if (!(await file.exists()) || !file.type.startsWith("image/")) {
        throw new Error(`Channel attachment is not an image file: ${path}`);
      }
      return absolutePath;
    }),
  );
}

/** Persist once, then apply the same audience plan for user and Agent senders. */
async function postMessage({
  id,
  channelId,
  sender,
  content,
  attachments,
}: {
  id: string;
  channelId: string;
  sender: Exclude<ChannelMessageSender, { type: "system" }>;
  content: string;
  attachments?: ChannelAttachment[];
}): Promise<ChannelMessage> {
  const database = new ChannelDatabase(await getStateDatabase());
  const [channel, members, agents] = await Promise.all([
    database.getChannel(channelId),
    database.listMembers(channelId),
    content.includes("@") || sender.type === "agent" ? listAgentProfiles() : [],
  ]);
  if (!channel) throw new Error("Channel not found.");
  const audience = resolveChannelAudience({
    content,
    sender,
    members,
    agents,
  });
  const message = await appendMessage(database, {
    id,
    channelId,
    sender,
    content,
    attachments,
  });

  const senderName =
    sender.type === "agent"
      ? (agents.find(({ id }) => id === sender.agentId)?.name ?? "an Agent")
      : "the user";
  const wake = (agentId: string) =>
    mentionAgent({
      host: { kind: "channel", channelId },
      agentId,
      message: { systemMessage: { type: "channel_message", senderName } },
      directory: channel.directory,
      hostLabel: channel.title,
    });
  await deliverChannelMessage(audience, wake);
  return message;
}

/** Atomically admit the shared Channel projection before announcing its current Agent identity. */
export async function admitChannelAgent(_agent: Agent, membership: AgentMembership): Promise<void> {
  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.createMember({
    channelId: membership.host.channelId,
    agentId: membership.agentId,
    sessionId: membership.sessionId,
  });
  publishChannelMessage(membership.host.channelId, change);
}

async function deliverChannelMessage(
  audience: {
    members: ChannelMember[];
    invitations: Array<Pick<Agent, "id">>;
  },
  wake: (agentId: string) => Promise<void>,
): Promise<void> {
  await Promise.all([
    ...audience.members.map((member) =>
      wake(member.agentId).catch((error) => {
        console.error(`Failed to wake Channel Agent ${member.sessionId}:`, error);
      }),
    ),
    ...audience.invitations.map((agent) =>
      wake(agent.id).catch((error) => {
        console.error(`Failed to invite Channel Agent ${agent.id}:`, error);
      }),
    ),
  ]);
}

export async function shareChannelArtifactFromAgent(
  sessionId: string,
  input: { path: string; title: string },
) {
  const database = new ChannelDatabase(await getStateDatabase());
  const member = await requireChannelMember(database, sessionId);
  const channel = await database.getChannel(member.host.channelId);
  if (!channel) throw new Error("Channel not found.");
  const workspaceDirectory = (await getSessionDirectory(sessionId)) ?? channel.directory;
  return shareChannelArtifact(database, channel.id, workspaceDirectory, {
    ...input,
    actor: { type: "agent", agentId: member.agentId },
  });
}

export async function shareChannelArtifactFromSession(
  sessionId: string,
  input: { channelId: string; path: string; title: string },
) {
  const database = new ChannelDatabase(await getStateDatabase());
  const channel = await database.getChannel(input.channelId);
  if (!channel) throw new Error("Channel not found.");
  const workspaceDirectory = (await getSessionDirectory(sessionId)) ?? channel.directory;
  return shareChannelArtifact(database, channel.id, workspaceDirectory, {
    ...input,
    actor: { type: "user" },
  });
}

async function shareChannelArtifact(
  database: ChannelDatabase,
  channelId: string,
  workspaceDirectory: string | undefined,
  input: {
    path: string;
    title: string;
    actor: Exclude<ChannelMessageSender, { type: "system" }>;
  },
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
  const change = await database.shareArtifact({
    id: crypto.randomUUID(),
    channelId,
    file: workspaceFileFromAbsolutePath(absolutePath),
    title: input.title,
    actor: input.actor,
  });
  publishChannelMessage(channelId, change);
  return publicChannelArtifact(change.artifact);
}

export async function detachChannelAgentSession(
  _agent: Agent,
  membership: AgentMembership,
): Promise<void> {
  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.deleteMemberBySession(membership.sessionId);
  if (change) publishChannelMessage(change.member.host.channelId, change);
}

async function requireChannelMember(
  database: ChannelDatabase,
  sessionId: string,
): Promise<ChannelMemberRecord> {
  const member = await database.getMemberBySession(sessionId);
  if (!member) throw new Error("This agent session does not belong to a channel.");
  return member;
}

async function appendMessage(
  database: ChannelDatabase,
  input: Parameters<ChannelDatabase["appendMessage"]>[0],
): Promise<ChannelMessage> {
  const change = await database.appendMessage(input);
  publishChannelMessage(input.channelId, change);
  return change.message;
}

function publishChannelMessage(
  channelId: string,
  change: { revision: number; message: ChannelMessage; channel: Channel },
): void {
  publishChannelEvent(channelId, {
    type: "message",
    revision: change.revision,
    message: change.message,
  });
  broadcast({ type: "channel.upserted", channel: change.channel });
}
