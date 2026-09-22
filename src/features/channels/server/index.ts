import { isAbsolute, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
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
  PostChannelMessageInput,
  RenameChannelInput,
  SetChannelStatusInput,
  SelfUpdateAgentInput,
  UpdateAgentInput,
  UpdateChannelInput,
} from "@channels/model";
import {
  agentHandleFromName,
  channelAgentMetadataSchema,
  channelLead,
  resolveChannelAudience,
} from "@channels/model";
import { resolveWorkspaceFile, workspaceFileFromAbsolutePath } from "@files/server/paths";
import {
  createSession,
  deleteSessionIfExists,
  deliverSessionMessage,
  getSessionDirectory,
  isSessionNotFoundError,
  waitForSessions,
} from "@sessions/server/runtime";
import type { SessionSystemMessage } from "@sessions/model";
import { getStateDatabase } from "@/server/database";
import { sharedMap } from "@/shared/server/processState";
import { SerialTaskQueue } from "@/shared/serialTaskQueue";
import { smallJsonSchema } from "@/shared/smallJson";
import { broadcast } from "@workspace/server/events";
import type { Worker } from "@workers/model";
import { ChannelDatabase, type ChannelAgentRecord } from "./database";
import {
  publishChannelEvent,
  releaseChannelEvents,
  replayChannelEvents,
  subscribeChannelEvents,
} from "./events";

const CHANNEL_MESSAGE_LIMIT = 100;
const agentTurnQueues = sharedMap<SerialTaskQueue>("channel-agent-turn-queues");

export async function listChannels(): Promise<ChannelList> {
  return new ChannelDatabase(await getStateDatabase()).listChannels();
}

export async function createChannelMember(input: CreateChannelMemberInput): Promise<ChannelMember> {
  const worker: Extract<Worker, { type: "channel" }> = {
    type: "channel",
    channelId: input.channelId,
    sessionId: crypto.randomUUID(),
    ephemeral: false,
    name: input.name,
    metadata: smallJsonSchema.parse(
      channelAgentMetadataSchema.parse({
        seenThrough: 0,
        ...(input.role ? { role: input.role } : {}),
        ...(input.model ? { model: input.model } : {}),
      }),
    ),
  };
  const change = await new ChannelDatabase(await getStateDatabase()).createMember(worker);
  publishChannelMessage(input.channelId, change);
  broadcastChannelMembers();
  return change.member;
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

export async function updateChannelAgent(input: UpdateAgentInput): Promise<ChannelMember> {
  const database = new ChannelDatabase(await getStateDatabase());
  const { agentId, ...update } = input;
  const change = await database.updateMember(agentId, update);
  publishChannelMember(change.member, change.revision);
  broadcastChannelMembers();
  return change.member;
}

export async function updateCurrentChannelAgent(
  sessionId: string,
  input: SelfUpdateAgentInput,
): Promise<ChannelMember> {
  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.updateMember(sessionId, input);
  publishChannelMember(change.member, change.revision);
  broadcastChannelMembers();
  return change.member;
}

export async function updateChannelFromLead(sessionId: string, input: UpdateChannelInput) {
  const change = await new ChannelDatabase(await getStateDatabase()).updateChannel(
    sessionId,
    input,
  );
  if (change.changed) broadcast({ type: "channel.upserted", channel: change.channel });
  return {
    ...(change.channel.purpose ? { purpose: change.channel.purpose } : {}),
    checklist: change.channel.checklist,
    ...(change.channel.previewUrl ? { previewUrl: change.channel.previewUrl } : {}),
  };
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
  if (input.directory) await mkdir(input.directory, { recursive: true });
  const channel = await new ChannelDatabase(await getStateDatabase()).createChannel(input);
  broadcast({ type: "channel.upserted", channel });
  void wakeChannelAgent(channel.leadId, { type: "channel_started" }).catch((error) => {
    console.error(`Failed to start the lead for Channel ${channel.id}:`, error);
  });
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
  for (const agentId of await database.listAgentIds(channelId)) {
    await deleteSessionIfExists(agentId);
  }
  if (!(await database.deleteChannel(channelId))) return false;
  releaseChannelEvents(channelId);
  broadcast({ type: "channel.deleted", channelId });
  return true;
}

export async function removeChannelMember(agentId: string): Promise<void> {
  const member = await new ChannelDatabase(await getStateDatabase()).getMember(agentId);
  if (!member) return;
  await deleteSessionIfExists(agentId);
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
  await database.markAgentSeen(agent, readThrough);
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
  const [lead, members, artifacts] = await Promise.all([
    database.getAgent(channel.leadId),
    database.listMembers(channel.id),
    database.listArtifacts(channel.id),
  ]);
  if (!lead?.isLead) throw new Error("Channel lead is incomplete.");
  return {
    channel: {
      name: channel.name,
      ...(channel.purpose ? { purpose: channel.purpose } : {}),
      checklist: channel.checklist,
      ...(channel.previewUrl ? { previewUrl: channel.previewUrl } : {}),
      ...(channel.directory ? { directory: channel.directory } : {}),
    },
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
  input: SetChannelStatusInput,
): Promise<ChannelAgentStatus> {
  const database = new ChannelDatabase(await getStateDatabase());
  const agent = await requireChannelAgent(database, sessionId);
  const status: ChannelAgentStatus = {
    state: "working",
    text: input.status,
    ...(input.lookingAt ? { lookingAt: input.lookingAt } : {}),
    ...(input.workingOn ? { workingOn: input.workingOn } : {}),
  };
  await setChannelAgentStatusValue(database, agent, status);
  return status;
}

async function startChannelAgentTurn(sessionId: string): Promise<void> {
  const database = new ChannelDatabase(await getStateDatabase());
  const agent = await database.getAgent(sessionId);
  if (!agent) return;
  const change = await database.clearWaitingAgentStatus(agent);
  if (change) publishChannelStatus(agent, change);
}

export async function finishChannelAgentTurn(
  sessionId: string,
  waitingFor?: string,
): Promise<void> {
  const database = new ChannelDatabase(await getStateDatabase());
  const agent = await database.getAgent(sessionId);
  if (!agent) return;
  await setChannelAgentStatusValue(
    database,
    agent,
    waitingFor ? { state: "waiting", text: waitingFor } : undefined,
  );
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

async function setChannelAgentStatusValue(
  database: ChannelDatabase,
  agent: ChannelAgentRecord,
  status?: ChannelAgentStatus,
): Promise<void> {
  const change = await database.setAgentStatus(agent, status);
  if (!change) return;
  publishChannelStatus(agent, change);
}

function publishChannelStatus(
  agent: ChannelAgent & { channelId: string },
  change: { revision: number; status?: ChannelAgentStatus },
): void {
  publishChannelEvent(agent.channelId, {
    type: "status",
    revision: change.revision,
    agentId: agent.id,
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
  const [channel, members] = await Promise.all([
    database.getChannel(channelId),
    database.listMembers(channelId),
  ]);
  if (!channel) throw new Error("Channel not found.");
  const lead = channelLead(channel.leadId);
  const audience = resolveChannelAudience({
    content,
    sender,
    lead,
    members,
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
      ? ([lead, ...members].find(({ id }) => id === sender.agentId)?.name ?? "an agent")
      : "the user";
  await Promise.all(
    audience.map((member) =>
      wakeChannelAgent(member.id, { type: "channel_message", senderName }).catch((error) => {
        console.error(`Failed to wake Channel Agent ${member.id}:`, error);
      }),
    ),
  );
  return message;
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
    id: crypto.randomUUID(),
    channelId,
    file: workspaceFileFromAbsolutePath(absolutePath),
    title: input.title,
    actor: input.actor,
  });
  if ("message" in result) publishChannelMessage(channelId, result);
  return publicChannelArtifact(result.artifact);
}

export async function detachChannelAgentSession(sessionId: string): Promise<void> {
  const database = new ChannelDatabase(await getStateDatabase());
  const agent = await database.getAgent(sessionId);
  if (agent?.isLead) return;
  const change = await database.deleteMember(sessionId);
  if (!change) return;
  publishChannelMessage(change.member.channelId, change);
  broadcastChannelMembers();
}

async function requireChannelAgent(database: ChannelDatabase, sessionId: string) {
  const agent = await database.getAgent(sessionId);
  if (!agent) throw new Error("This agent session does not belong to a channel.");
  return agent;
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

async function wakeChannelAgent(
  agentId: string,
  systemMessage: SessionSystemMessage,
): Promise<void> {
  return withAgentTurn(agentId, async () => {
    const database = new ChannelDatabase(await getStateDatabase());
    const agent = await database.getAgent(agentId);
    if (!agent) throw new Error("Channel agent not found.");
    const channel = await database.getChannel(agent.channelId);
    if (!channel) throw new Error("Channel not found.");

    try {
      await deliverSessionMessage(agentId, { systemMessage, immediate: true });
      await startChannelAgentTurn(agentId);
      return;
    } catch (error) {
      if (!isSessionNotFoundError(error)) throw error;
    }

    await createSession(
      agentId,
      { systemMessage },
      {
        directory: channel.directory,
        sessionType: "worker",
        name: `${agent.name} · ${channel.name}`,
      },
    );
    await startChannelAgentTurn(agentId);
  });
}

function withAgentTurn<Result>(agentId: string, operation: () => Promise<Result>): Promise<Result> {
  let queue = agentTurnQueues.get(agentId);
  if (!queue) {
    queue = new SerialTaskQueue();
    agentTurnQueues.set(agentId, queue);
  }
  return queue.enqueue(operation);
}

function publishChannelMember(member: ChannelMember, revision: number): void {
  publishChannelEvent(member.channelId, { type: "member", revision, member });
}

function broadcastChannelMembers(): void {
  broadcast({ type: "channel.members.changed" });
}
