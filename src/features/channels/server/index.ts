import { isAbsolute, resolve } from "node:path";
import type {
  Channel,
  ChannelAgentStatus,
  ChannelList,
  ChannelMember,
  ChannelMessage,
  ChannelMessageSender,
  ChannelReaction,
  ChannelRoutine,
  CreateChannelMemberInput,
  CreateChannelInput,
  EditChannelInput,
  PostChannelMessageInput,
  SetChannelAgentStatusInput,
  SetChannelRoutineInput,
  ChannelMemberChanges,
  UpdateChannelInput,
} from "@channels/model";
import {
  channelLead,
  channelMemberIdentity,
  resolveChannelAudience,
  isChannelSystemMessage,
} from "@channels/model";
import { workspaceFileFromAbsolutePath } from "@files/server/paths";
import {
  deliverSessionMessage,
  getSessionDirectory,
  waitForSessions,
} from "@sessions/server/runtime";
import type { SessionSystemMessage } from "@sessions/model";
import { getStateDatabase } from "@/server/database";
import { broadcast } from "@workspace/server/events";
import { deleteWorker, spawnWorker } from "@workers/server";
import { ChannelDatabase, type StoredChannelMessage, type ChannelChange } from "./database";
import { resolveMessageResources, resolveEventResources } from "./resources";
import { publishChannelEvent, releaseChannelEvents } from "./events";

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
      publishChannelChange(change);
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
  publishChannelChange(change);
  return change.member;
}

export async function updateChannelFromLead(sessionId: string, input: UpdateChannelInput) {
  const database = new ChannelDatabase(await getStateDatabase());
  if (input.directory && !isAbsolute(input.directory)) {
    throw new Error("Use an absolute working directory.");
  }
  const change = await database.updateChannel(sessionId, input);
  publishChannelChange(change);
  return change.channel;
}

export async function getChannelHistory(channelId: string, beforeSequence: number) {
  const database = new ChannelDatabase(await getStateDatabase());
  const page = await database.getHistory(channelId, beforeSequence);
  return page && { ...page, messages: page.messages.map(resolveMessageResources) };
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
  publishChannelChange(change);
  if (change.purposeChanged) {
    void wakeChannelAgent(change.channel.id, {
      type: "channel_message",
      senderName: "the user",
    }).catch((error) => {
      console.error(`Failed to notify Channel lead ${change.channel.id}:`, error);
    });
  }
  return change.channel;
}

export async function deleteChannel(channelId: string): Promise<boolean> {
  const database = new ChannelDatabase(await getStateDatabase());
  const agentIds = await database.deleteChannel(channelId);
  if (!agentIds) return false;
  releaseChannelEvents(channelId);
  broadcast({ type: "channel.deleted", channelId });
  const cleanup = await Promise.allSettled(agentIds.map((id) => deleteWorker(id)));
  const errors = cleanup.flatMap((result, index) =>
    result.status === "rejected"
      ? [new Error(`Unable to delete agent ${agentIds[index]}`, { cause: result.reason })]
      : [],
  );
  if (errors.length) throw new AggregateError(errors, "Channel deleted; agent cleanup failed.");
  return true;
}

export async function removeChannelMember(agentId: string): Promise<void> {
  const member = await new ChannelDatabase(await getStateDatabase()).getMember(agentId);
  if (!member) return;
  await deleteWorker(agentId, "channel");
}

export async function markChannelRead(
  channelId: string,
  sequence: number,
): Promise<Channel | null> {
  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.markUserSeen(channelId, sequence);
  if (change) publishChannelChange(change);
  return change?.channel ?? database.getChannel(channelId);
}

export async function postChannelMessage(input: PostChannelMessageInput): Promise<ChannelMessage> {
  return resolveMessageResources(await postMessage({ ...input, sender: { type: "user" } }));
}

export async function postChannelMessageFromSession(
  sessionId: string,
  input: Omit<PostChannelMessageInput, "attachments"> & {
    attachmentPaths?: readonly string[];
  },
): Promise<StoredChannelMessage> {
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
  const messages = await database.listMessagesBefore(
    channel.id,
    beforeSequence,
    CHANNEL_MESSAGE_LIMIT,
  );
  return readChannel(database, channel, messages, (messages[0]?.sequence ?? 1) > 1);
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

async function readChannel(
  database: ChannelDatabase,
  channel: Channel,
  messages: StoredChannelMessage[],
  hasMore: boolean,
) {
  const [roster, artifacts, routines] = await Promise.all([
    database.getRoster(channel.id),
    database.listArtifacts(channel.id),
    database.listRoutines(channel.id),
  ]);
  if (!roster) throw new Error("Channel not found.");
  const { lead, members } = roster;
  return {
    channel,
    lead,
    members,
    messages,
    artifacts,
    routines,
    hasMore,
  };
}

export async function sendChannelMessageFromAgent(
  sessionId: string,
  input: {
    content: string;
    attachmentPaths?: readonly string[];
    request?: boolean;
  },
): Promise<StoredChannelMessage> {
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
    request: input.request,
  });
}

export async function setChannelMessageReactionFromAgent(
  sessionId: string,
  input: { sequence: number; reaction: ChannelReaction["reaction"] | null },
): Promise<ChannelReaction["reaction"] | null> {
  const database = new ChannelDatabase(await getStateDatabase());
  const agent = await requireChannelAgent(database, sessionId);
  const change = await database.setMessageReaction({
    channelId: agent.channelId,
    sequence: input.sequence,
    agentId: agent.id,
    reaction: input.reaction,
  });
  if (!change) return null;
  const reaction = change.reaction?.reaction ?? null;
  publishChannelChange(change);
  return reaction;
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
  if (change) publishChannelChange(change);
  return status;
}

/** Ends a turn. A lead waiting on a member or external work can ask to wake after a delay. */
export async function finishChannelAgentTurn(
  sessionId: string,
  waitingFor?: string,
  wakeAfterMinutes?: number,
): Promise<void> {
  const database = new ChannelDatabase(await getStateDatabase());
  const wakeAt = wakeAfterMinutes
    ? new Date(Date.now() + wakeAfterMinutes * 60_000).toISOString()
    : undefined;
  const change = await database.setAgentStatus(
    sessionId,
    waitingFor ? { state: "waiting", text: waitingFor, ...(wakeAt ? { wakeAt } : {}) } : undefined,
    false,
  );
  if (change) publishChannelChange(change);
}

export async function setChannelRoutineFromLead(
  sessionId: string,
  input: SetChannelRoutineInput,
): Promise<ChannelRoutine> {
  const change = await new ChannelDatabase(await getStateDatabase()).setRoutine(sessionId, input);
  publishChannelChange(change);
  return change.routine;
}

/** Returns false when the routine was already gone. */
export async function deleteChannelRoutine(channelId: string, routineId: string): Promise<boolean> {
  const change = await new ChannelDatabase(await getStateDatabase()).deleteRoutine(
    channelId,
    routineId,
  );
  if (!change) return false;
  publishChannelChange(change);
  return true;
}

/** Privately wake each lead whose follow-up or routine is due. Claims commit before delivery. */
export async function wakeDueChannelAgents(now = new Date()): Promise<void> {
  try {
    const database = await getStateDatabase({ createIfMissing: false });
    if (!database) return;
    const { followUps, routines } = await new ChannelDatabase(database).claimDueWakes(now);
    for (const { change } of followUps) publishChannelChange(change);
    await Promise.all([
      ...followUps.map(({ agentId, waitingFor }) =>
        wakeLead(agentId, { type: "channel_follow_up", waitingFor }),
      ),
      ...routines.map(({ channelId, title, prompt }) =>
        wakeLead(channelId, { type: "channel_routine", title, prompt }),
      ),
    ]);
  } catch (error) {
    console.error("Failed to wake due Channel agents:", error);
  }
}

/** Runs a routine now without changing its schedule. Returns false when it's already gone. */
export async function runChannelRoutine(channelId: string, routineId: string): Promise<boolean> {
  const routines = await new ChannelDatabase(await getStateDatabase()).listRoutines(channelId);
  const routine = routines.find(({ id }) => id === routineId);
  if (!routine) return false;
  await wakeChannelAgent(channelId, {
    type: "channel_routine",
    title: routine.title,
    prompt: routine.prompt,
  });
  return true;
}

function wakeLead(leadId: string, systemMessage: SessionSystemMessage): Promise<void> {
  return wakeChannelAgent(leadId, systemMessage).catch((error) => {
    console.error(`Failed to wake Channel lead ${leadId}:`, error);
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
async function postMessage(
  input: Parameters<ChannelDatabase["appendMessage"]>[0],
): Promise<StoredChannelMessage> {
  const { channelId, sender, content } = input;
  const database = new ChannelDatabase(await getStateDatabase());
  const members = await database.listMembers(channelId);
  const change = await database.appendMessage(input);
  const lead = channelLead(change.channel.id);
  publishChannelChange(change);
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
  return shareChannelArtifact(database, sessionId, agent.channelId, {
    ...input,
    actor: { type: "agent", agentId: agent.id },
  });
}

export async function shareChannelArtifactFromSession(
  sessionId: string,
  { channelId, ...input }: { channelId: string; path: string; title: string },
) {
  const database = new ChannelDatabase(await getStateDatabase());
  return shareChannelArtifact(database, sessionId, channelId, {
    ...input,
    actor: { type: "user" },
  });
}

/** Relative paths resolve against the sharing Session's workspace, then the Channel's directory. */
async function shareChannelArtifact(
  database: ChannelDatabase,
  sessionId: string,
  channelId: string,
  input: {
    path: string;
    title: string;
    actor: Exclude<ChannelMessageSender, { type: "system" }>;
  },
) {
  const channel = await database.getChannel(channelId);
  if (!channel) throw new Error("Channel not found.");
  const workspaceDirectory = (await getSessionDirectory(sessionId)) ?? channel.directory;
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
  publishChannelChange(result);
  return result.artifact;
}

export async function detachChannelAgentSession(sessionId: string): Promise<void> {
  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.deleteMember(sessionId);
  if (!change) return;
  publishChannelChange(change);
}

async function requireChannelAgent(database: ChannelDatabase, sessionId: string) {
  const agent = await database.getAgent(sessionId);
  if (!agent) throw new Error("This agent session does not belong to a channel.");
  return agent;
}

/** Publish the committed detail events and their catalog projections together. */
export function publishChannelChange({ channelId, events, channel }: ChannelChange): void {
  if (events.length === 0) return;
  for (const stored of events) {
    const event = resolveEventResources(stored);
    publishChannelEvent(channelId, event);
    if (event.type === "member") {
      broadcast({ type: "channel.member.upserted", member: channelMemberIdentity(event.member) });
    } else if (event.type === "message" && isChannelSystemMessage(event.message)) {
      const content = event.message.content;
      if (content.type === "member_joined")
        broadcast({
          type: "channel.member.upserted",
          member: channelMemberIdentity(content.member),
        });
      else if (content.type === "member_left")
        broadcast({ type: "channel.member.deleted", channelId, agentId: content.member.id });
    }
  }
  if (channel) broadcast({ type: "channel.upserted", channel });
}

async function wakeChannelAgent(
  agentId: string,
  systemMessage: SessionSystemMessage,
): Promise<void> {
  await deliverSessionMessage(agentId, { systemMessage, immediate: true });
  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.clearAgentStatus(agentId, "waiting");
  if (change) publishChannelChange(change);
}
