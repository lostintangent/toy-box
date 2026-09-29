import { isAbsolute, resolve } from "node:path";
import type {
  Channel,
  ChannelAgent,
  ChannelAgentStatus,
  ChannelAttachment,
  ChannelArtifact,
  ChannelEvent,
  ChannelList,
  ChannelMember,
  ChannelMessage,
  ChannelMessageSender,
  ChannelReaction,
  ChannelState,
  CreateChannelMemberInput,
  CreateChannelInput,
  EditChannelInput,
  PostChannelMessageInput,
  SetChannelAgentStatusInput,
  ChannelMemberChanges,
  UpdateChannelInput,
} from "@channels/model";
import { agentHandleFromName, channelLead, resolveChannelAudience } from "@channels/model";
import { resolveWorkspaceFile, workspaceFileFromAbsolutePath } from "@files/server/paths";
import {
  deliverSessionMessage,
  getSessionDirectory,
  waitForSessions,
} from "@sessions/server/runtime";
import type { SessionSystemMessage } from "@sessions/model";
import { getStateDatabase } from "@/server/database";
import { broadcast } from "@workspace/server/events";
import { deleteWorker, spawnWorker } from "@workers/server";
import { ChannelDatabase } from "./database";
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

export async function createChannelMember({
  channelId,
  name,
  ...profile
}: CreateChannelMemberInput): Promise<ChannelMember> {
  const database = new ChannelDatabase(await getStateDatabase());
  const { value: member } = await spawnWorker({
    owner: { type: "channel", channelId },
    name,
    metadata: { seenThrough: 0, ...profile },
    retention: "durable",
    message: {
      content:
        "You have joined this channel. Read its context and complete any missing profile details. If you have been assigned work, begin it. Otherwise finish your turn quietly, without a readiness message or waiting status.",
    },
    admit: async (worker) => {
      const change = await database.createMember(worker);
      publishChannelMessage(change);
      broadcastChannelMembers();
      return change.member;
    },
  });
  return member;
}

export async function createChannelMembers(
  channelId: string,
  members: readonly Omit<CreateChannelMemberInput, "channelId">[],
): Promise<ChannelMember[]> {
  const created: ChannelMember[] = [];
  for (const member of members) {
    created.push(await createChannelMember({ ...member, channelId }));
  }
  return created;
}

export async function createChannelMembersFromLead(
  sessionId: string,
  members: readonly Omit<CreateChannelMemberInput, "channelId">[],
): Promise<ChannelMember[]> {
  const agent = await requireChannelAgent(new ChannelDatabase(await getStateDatabase()), sessionId);
  if (!agent.isLead) throw new Error("Only the channel lead can create members.");
  return createChannelMembers(agent.channelId, members);
}

export async function updateChannelMember(
  input: ChannelMemberChanges & { agentId: string },
): Promise<ChannelMember> {
  const database = new ChannelDatabase(await getStateDatabase());
  const { agentId, ...update } = input;
  const change = await database.updateMember(agentId, update);
  if (change.changed) {
    publishChannelMember(change.member, change.revision);
    broadcastChannelMembers();
  }
  return change.member;
}

export async function updateChannelFromLead(sessionId: string, input: UpdateChannelInput) {
  const database = new ChannelDatabase(await getStateDatabase());
  if (input.directory && !isAbsolute(input.directory)) {
    throw new Error("Use an absolute working directory.");
  }
  const change = await database.updateChannel(sessionId, input);
  if (change.changed) publishChannelChange(change);
  return publicChannel(change.channel);
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
  const channelId = crypto.randomUUID();
  const database = new ChannelDatabase(await getStateDatabase());
  const { value: channel } = await spawnWorker({
    sessionId: channelId,
    owner: { type: "channel", channelId },
    name: `Lead · ${input.name}`,
    metadata: { seenThrough: 0 },
    retention: "durable",
    message: { content: "This channel was just created. Begin working toward its purpose." },
    admit: async (lead) => {
      const channel = await database.createChannel(input, lead);
      broadcast({ type: "channel.upserted", channel });
      return channel;
    },
  });
  return channel;
}

export async function editChannel(input: EditChannelInput): Promise<Channel> {
  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.editChannel(input);
  if (change.changed) {
    publishChannelChange(change);
    if (change.messages.some(({ message }) => message.content.type === "channel_purpose_changed")) {
      void wakeChannelAgent(change.channel.id, {
        type: "channel_message",
        senderName: "the user",
      }).catch((error) => {
        console.error(`Failed to notify Channel lead ${change.channel.id}:`, error);
      });
    }
  }
  return change.channel;
}

export async function deleteChannel(channelId: string): Promise<boolean> {
  const database = new ChannelDatabase(await getStateDatabase());
  for (const agentId of await database.listAgentIds(channelId)) {
    await deleteWorker(agentId, "channel");
  }
  if (!(await database.deleteChannel(channelId))) return false;
  releaseChannelEvents(channelId);
  broadcast({ type: "channel.deleted", channelId });
  return true;
}

export async function removeChannelMember(agentId: string): Promise<void> {
  const member = await new ChannelDatabase(await getStateDatabase()).getMember(agentId);
  if (!member) return;
  await deleteWorker(agentId, "channel");
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

export async function waitForChannelAgents(
  channelId: string,
  agentIds: readonly string[],
  timeoutMs?: number,
) {
  const agentIdsInChannel = new Set(
    await new ChannelDatabase(await getStateDatabase()).listAgentIds(channelId),
  );
  if (agentIds.some((agentId) => !agentIdsInChannel.has(agentId))) {
    throw new Error("One or more agent IDs do not belong to this channel.");
  }
  const completions = await waitForSessions(agentIds, timeoutMs);
  return completions.map(({ status }, index) => ({ agentId: agentIds[index]!, status }));
}

export async function readChannelForAgent(sessionId: string) {
  const database = new ChannelDatabase(await getStateDatabase());
  const agent = await requireChannelAgent(database, sessionId);
  const channel = await database.getChannel(agent.channelId);
  if (!channel) throw new Error("Channel not found.");
  const messages = await database.listMessagesAfter(
    channel.id,
    agent.seenThrough,
    CHANNEL_MESSAGE_LIMIT,
  );
  const readThrough = messages.at(-1)?.sequence ?? agent.seenThrough;
  const result = await readChannel(
    database,
    channel,
    messages,
    readThrough < channel.latestSequence,
  );
  await database.markAgentSeen(agent.id, readThrough);
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
  const [{ lead, members }, artifacts] = await Promise.all([
    database.getRoster(channel.id),
    database.listArtifacts(channel.id),
  ]);
  return {
    channel: publicChannel(channel),
    lead: publicChannelLead(lead),
    members: members.map(publicChannelMember),
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

function publicChannel({ name, purpose, directory, checklist, previewUrl }: Channel) {
  return { name, purpose, directory, checklist, previewUrl };
}

/** Public collaboration facts omit each agent's private read position and runtime details. */
function publicChannelMember(member: ChannelMember) {
  return { memberId: member.id, ...publicChannelAgent(member) };
}

function publicChannelLead(lead: ChannelAgent) {
  return { leadId: lead.id, ...publicChannelAgent(lead) };
}

function publicChannelAgent(agent: ChannelAgent) {
  return {
    name: agent.name,
    mention: `@${agentHandleFromName(agent.name)}`,
    role: agent.role,
    ...(agent.status ? { status: agent.status } : {}),
  };
}

function publicChannelArtifact({ file, title }: Pick<ChannelArtifact, "file" | "title">) {
  return { path: resolveWorkspaceFile(file)!, title };
}

export async function sendChannelMessageFromAgent(
  sessionId: string,
  input: {
    content: string;
    attachmentPaths?: readonly string[];
  },
): Promise<ChannelMessage> {
  const agent = await requireChannelAgent(new ChannelDatabase(await getStateDatabase()), sessionId);
  return postMessage({
    id: crypto.randomUUID(),
    channelId: agent.channelId,
    sender: {
      type: "agent",
      agentId: agent.id,
    },
    content: input.content,
    attachments: await resolveAttachmentPaths(sessionId, input.attachmentPaths),
  });
}

export async function markChannelDoneFromLead(sessionId: string): Promise<ChannelMessage> {
  const change = await new ChannelDatabase(await getStateDatabase()).markDone(sessionId);
  publishChannelMessage(change);
  return change.message;
}

export async function requestChannelUserAttentionFromLead(
  sessionId: string,
  requestSequence: number,
): Promise<ChannelMessage> {
  const change = await new ChannelDatabase(await getStateDatabase()).requestUserAttention(
    sessionId,
    requestSequence,
  );
  if (change.changed) publishChannelMessage(change);
  return change.message;
}

export async function setChannelMessageReactionFromAgent(
  sessionId: string,
  input: { sequence: number; reaction: ChannelReaction["reaction"] | null },
): Promise<ChannelReaction["reaction"] | null> {
  const database = new ChannelDatabase(await getStateDatabase());
  const agent = await requireChannelAgent(database, sessionId);
  return setChannelAgentReaction(database, agent, input.sequence, input.reaction);
}

export async function setChannelAgentStatus(
  sessionId: string,
  input: SetChannelAgentStatusInput,
): Promise<ChannelAgentStatus> {
  const database = new ChannelDatabase(await getStateDatabase());
  const status: ChannelAgentStatus = {
    state: "working",
    text: input.status,
    ...(input.lookingAt ? { lookingAt: input.lookingAt } : {}),
    ...(input.workingOn ? { workingOn: input.workingOn } : {}),
  };
  const change = await database.setAgentStatus(sessionId, status);
  if (change) publishChannelStatus(change);
  return status;
}

async function clearChannelAgentWaitingStatus(sessionId: string): Promise<void> {
  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.clearWaitingAgentStatus(sessionId);
  if (change) publishChannelStatus(change);
}

export async function finishChannelAgentTurn(
  sessionId: string,
  waitingFor?: string,
): Promise<void> {
  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.setAgentStatus(
    sessionId,
    waitingFor ? { state: "waiting", text: waitingFor } : undefined,
    false,
  );
  if (change) publishChannelStatus(change);
}

async function setChannelAgentReaction(
  database: ChannelDatabase,
  agent: ChannelAgent & { channelId: string },
  sequence: number,
  reaction: ChannelReaction["reaction"] | null,
): Promise<ChannelReaction["reaction"] | null> {
  const channelId = agent.channelId;
  const change = await database.setMessageReaction({
    channelId,
    sequence,
    agentId: agent.id,
    reaction,
  });
  if (!change) return null;
  const currentReaction = change.reaction?.reaction ?? null;
  publishChannelEvent(channelId, {
    type: "reaction",
    revision: change.revision,
    sequence,
    agentId: agent.id,
    reaction: currentReaction,
  });
  return currentReaction;
}

function publishChannelStatus(change: {
  agentId: string;
  channelId: string;
  revision: number;
  status?: ChannelAgentStatus;
}): void {
  const { channelId, ...event } = change;
  publishChannelEvent(channelId, { type: "status", ...event });
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
  const members = await database.listMembers(channelId);
  const change = await database.appendMessage({
    id,
    channelId,
    sender,
    content,
    attachments,
  });
  const lead = channelLead(change.channel.id);
  publishChannelMessage(change);
  const audience = resolveChannelAudience({
    content,
    sender,
    lead,
    members,
    acknowledgedRequest: change.acknowledgedRequest,
  });

  const senderName =
    sender.type === "agent"
      ? ([lead, ...members].find(({ id }) => id === sender.agentId)?.name ?? "an agent")
      : "the user";
  await Promise.all(
    audience.map((member) =>
      wakeChannelAgent(member.id, { type: "channel_message", senderName }).catch((error) => {
        console.error(`Failed to wake Channel Agent ${member.id}:`, error);
      }),
    ),
  );
  return change.message;
}

export async function shareChannelArtifactFromAgent(
  sessionId: string,
  input: { path: string; title: string },
) {
  const database = new ChannelDatabase(await getStateDatabase());
  const agent = await requireChannelAgent(database, sessionId);
  const channel = await database.getChannel(agent.channelId);
  if (!channel) throw new Error("Channel not found.");
  const workspaceDirectory = (await getSessionDirectory(sessionId)) ?? channel.directory;
  return shareChannelArtifact(database, channel.id, workspaceDirectory, {
    ...input,
    actor: { type: "agent", agentId: agent.id },
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
  const result = await database.shareArtifact({
    channelId,
    file: workspaceFileFromAbsolutePath(absolutePath),
    title: input.title,
    actor: input.actor,
  });
  if ("message" in result) publishChannelMessage(result);
  return publicChannelArtifact(result.artifact);
}

export async function detachChannelAgentSession(sessionId: string): Promise<void> {
  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.deleteMember(sessionId);
  if (!change) return;
  publishChannelMessage(change);
  broadcastChannelMembers();
}

async function requireChannelAgent(database: ChannelDatabase, sessionId: string) {
  const agent = await database.getAgent(sessionId);
  if (!agent) throw new Error("This agent session does not belong to a channel.");
  return agent;
}

function publishChannelMessage(change: {
  revision: number;
  message: ChannelMessage;
  channel: Channel;
}): void {
  publishChannelChange({ channel: change.channel, messages: [change] });
}

function publishChannelChange(change: {
  channel: Channel;
  messages: readonly { revision: number; message: ChannelMessage }[];
}): void {
  for (const { revision, message } of change.messages) {
    publishChannelEvent(change.channel.id, { type: "message", revision, message });
  }
  broadcast({ type: "channel.upserted", channel: change.channel });
}

async function wakeChannelAgent(
  agentId: string,
  systemMessage: SessionSystemMessage,
): Promise<void> {
  await deliverSessionMessage(agentId, { systemMessage, immediate: true });
  await clearChannelAgentWaitingStatus(agentId);
}

function publishChannelMember(member: ChannelMember, revision: number): void {
  publishChannelEvent(member.channelId, { type: "member", revision, member });
}

function broadcastChannelMembers(): void {
  broadcast({ type: "channel.members.changed" });
}
