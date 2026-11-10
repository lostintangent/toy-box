import { basename, isAbsolute, resolve } from "node:path";
import type {
  Channel,
  ChannelAgentStatus,
  ChannelCatalogEntry,
  ChannelList,
  ChannelMember,
  ChannelMessage,
  ChannelMessageActor,
  ChannelReaction,
  ChannelRoutine,
  CreateChannelMemberInput,
  CreateChannelInput,
  EditChannelInput,
  EditChannelTasksInput,
  BookmarkChannelMessageInput,
  SetChannelAgentStatusInput,
  SetChannelRoutineInput,
  ChannelMemberChanges,
  UpdateChannelInput,
} from "@channels/model";
import {
  channelLead,
  channelMemberIdentity,
  resolveChannelAgentId,
  resolveChannelAudience,
  isChannelSystemMessage,
} from "@channels/model";
import { workspaceFileFromAbsolutePath } from "@files/server/paths";
import { deliverSessionMessage, waitForSessions } from "@sessions/server/runtime";
import type { SessionSystemMessage } from "@sessions/model";
import type { Attachment } from "@/shared/attachments/model";
import { getStateDatabase } from "@/server/database";
import { broadcast } from "@workspace/server/events";
import { deleteSavedDraft } from "@workspace/server/state/drafts";
import { readSession } from "@sessions/server/state/sessions";
import { deleteWorker, spawnWorker } from "@workers/server";
import { ChannelDatabase, ChannelInputError, catalogEntry, type ChannelChange } from "./database";
import { deleteChannelFiles, storeChannelAttachments } from "./attachments";
import { publishChannelEvent, releaseChannelEvents } from "./events";
import { publishChannelNotification } from "./push";

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

export async function updateChannelMember(
  input: ChannelMemberChanges & { agentId: string },
): Promise<ChannelMember> {
  const database = new ChannelDatabase(await getStateDatabase());
  const { agentId, ...update } = input;
  if (update.model) {
    const provider = (await readSession(agentId))?.provider?.id;
    if (provider && update.model.provider !== provider) {
      throw new ChannelInputError(
        "A member's provider cannot change without losing its session history.",
      );
    }
  }
  const change = await database.updateMember(agentId, update);
  publishChannelChange(change);
  return change.member;
}

/** The intrinsic lead is never a member. */
export async function resolveChannelMember(channelId: string, reference: string): Promise<string> {
  const members = await new ChannelDatabase(await getStateDatabase()).listMembers(channelId);
  const memberId = resolveChannelAgentId(members, reference);
  if (!memberId) throw new Error("Member not found in this channel.");
  return memberId;
}

/** The lead's update, recorded as its own. The user edits with `editChannel`. */
export async function updateChannel(channelId: string, input: UpdateChannelInput) {
  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.updateChannel(channelId, input);
  publishChannelChange(change);
  return change.channel;
}

export async function editChannelTasks(
  channelId: string,
  input: EditChannelTasksInput,
): Promise<void> {
  const change = await new ChannelDatabase(await getStateDatabase()).editTasks(channelId, input);
  publishChannelChange(change);
}

export async function getChannelHistory(channelId: string, beforeSequence: number) {
  return new ChannelDatabase(await getStateDatabase()).getHistory(channelId, beforeSequence);
}

export async function createChannel(input: CreateChannelInput): Promise<ChannelCatalogEntry> {
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
      const channel = catalogEntry(await database.createChannel(input, lead));
      broadcast({ type: "channel.upserted", channel });
      return channel;
    },
  });
  return channel;
}

export async function editChannel(input: EditChannelInput): Promise<ChannelCatalogEntry> {
  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.editChannel(input);
  publishChannelChange(change);
  if (change.purposeChanged) {
    void wakeQuietly(change.channel.id, { type: "channel_message", senderName: "the user" });
  }
  return catalogEntry(change.channel);
}

export async function deleteChannel(channelId: string): Promise<boolean> {
  const database = new ChannelDatabase(await getStateDatabase());
  const agentIds = await database.deleteChannel(channelId);
  if (!agentIds) return false;
  releaseChannelEvents(channelId);
  deleteSavedDraft(`channel:${channelId}`);
  broadcast({ type: "channel.deleted", channelId });
  const cleanup = await Promise.allSettled(agentIds.map((id) => deleteWorker(id)));
  await deleteChannelFiles(channelId);
  const errors = cleanup.flatMap((result, index) =>
    result.status === "rejected"
      ? [new Error(`Unable to delete agent ${agentIds[index]}`, { cause: result.reason })]
      : [],
  );
  if (errors.length) throw new AggregateError(errors, "Channel deleted; agent cleanup failed.");
  return true;
}

/** Records the removal before tearing down the Session, whose detach would record the user. */
export async function removeChannelMember(agentId: string, actor: ChannelMessageActor) {
  const change = await new ChannelDatabase(await getStateDatabase()).deleteMember(agentId, actor);
  if (!change) return;
  publishChannelChange(change);
  await deleteWorker(agentId);
}

/** The intrinsic lead is never a member. */
export async function isChannelMember(channelId: string, agentId: string): Promise<boolean> {
  const member = await new ChannelDatabase(await getStateDatabase()).getMember(agentId);
  return member?.channelId === channelId;
}

/** A started member's session fixes its provider; before that, its configured model suggests one. */
export async function getChannelMemberProvider(channelId: string, agentId: string) {
  const member = await new ChannelDatabase(await getStateDatabase()).getMember(agentId);
  if (member?.channelId !== channelId) return undefined;
  const session = (await readSession(agentId))?.provider?.id ?? null;
  return session ?? member.model?.provider ?? null;
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

export async function bookmarkChannelMessage(input: BookmarkChannelMessageInput): Promise<void> {
  const change = await new ChannelDatabase(await getStateDatabase()).bookmarkMessage(input);
  if (change) publishChannelChange(change);
}

/**
 * Persist once, then apply the same audience plan for user and Agent senders. A path
 * attachment names an absolute image or video file, which the Channel copies.
 */
export async function postChannelMessage(
  {
    attachments: sources,
    ...input
  }: Omit<Parameters<ChannelDatabase["appendMessage"]>[0], "attachments" | "sender"> & {
    attachments?: readonly (Attachment | string)[];
  },
  sender: ChannelMessageActor,
): Promise<ChannelMessage> {
  const { channelId, content } = input;
  await Promise.all(sources?.filter((source) => typeof source === "string").map(assertMedia) ?? []);
  const database = new ChannelDatabase(await getStateDatabase());
  const members = await database.listMembers(channelId);
  // Its ID and the message's become a folder path, so check them before writing files.
  if (sources?.length) {
    if (!(await database.getChannel(channelId))) throw new Error("Channel not found.");
    if (input.id !== basename(input.id) || input.id === "." || input.id === "..") {
      throw new ChannelInputError("A message with attachments needs an ID without slashes.");
    }
  }
  const attachments = sources?.length
    ? await storeChannelAttachments(channelId, input.id, sources)
    : undefined;
  const change = await database.appendMessage({ ...input, sender, attachments });
  if (change.events.length === 0) return change.message;
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
    audience.map((member) => wakeQuietly(member.id, { type: "channel_message", senderName })),
  );
  return change.message;
}

export async function readChannel(channelId: string, beforeSequence?: number) {
  const database = new ChannelDatabase(await getStateDatabase());
  const channel = await database.getChannel(channelId);
  if (!channel) throw new Error("Channel not found.");
  const messages = await database.listMessagesBefore(
    channel.id,
    beforeSequence,
    CHANNEL_MESSAGE_LIMIT,
  );
  return assembleChannelRead(database, channel, messages, (messages[0]?.sequence ?? 1) > 1);
}

export async function waitForChannelAgents(
  channelId: string,
  references: readonly string[],
  timeoutMs?: number,
) {
  const agents = await new ChannelDatabase(await getStateDatabase()).listAgents(channelId);
  const agentIds = references.map((reference) => {
    const agentId = resolveChannelAgentId(agents, reference);
    if (!agentId) throw new Error("One or more agents do not belong to this channel.");
    return agentId;
  });
  const completions = await waitForSessions(agentIds, timeoutMs);
  return completions.map(({ status }, index) => ({ agentId: agentIds[index]!, status }));
}

/** Reads from the agent's cursor and advances it. */
export async function readChannelUnread(agentId: string) {
  const database = new ChannelDatabase(await getStateDatabase());
  const agent = await requireChannelAgent(agentId);
  const channel = await database.getChannel(agent.channelId);
  if (!channel) throw new Error("Channel not found.");
  const messages = await database.listMessagesAfter(
    channel.id,
    agent.seenThrough,
    CHANNEL_MESSAGE_LIMIT,
  );
  const readThrough = messages.at(-1)?.sequence ?? agent.seenThrough;
  const result = await assembleChannelRead(
    database,
    channel,
    messages,
    readThrough < channel.latestSequence,
  );
  await database.markAgentSeen(agent.id, readThrough);
  return { ...result, isInitialRead: agent.seenThrough === 0 };
}

async function assembleChannelRead(
  database: ChannelDatabase,
  channel: Channel,
  messages: ChannelMessage[],
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

export async function setChannelMessageReaction(
  agentId: string,
  input: { sequence: number; reaction: ChannelReaction["reaction"] | null },
): Promise<ChannelReaction["reaction"] | null> {
  const database = new ChannelDatabase(await getStateDatabase());
  const agent = await requireChannelAgent(agentId);
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

/** Ends a turn. An agent waiting on a teammate or external work can ask to wake after a delay. */
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

export async function setChannelRoutine(
  channelId: string,
  input: SetChannelRoutineInput,
): Promise<ChannelRoutine> {
  const change = await new ChannelDatabase(await getStateDatabase()).setRoutine(channelId, input);
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

/** Returns false when the artifact was already gone. Its file stays on disk. */
export async function removeChannelArtifact(
  channelId: string,
  artifactId: string,
  actor: ChannelMessageActor,
): Promise<boolean> {
  const change = await new ChannelDatabase(await getStateDatabase()).removeArtifact(
    channelId,
    artifactId,
    actor,
  );
  if (!change) return false;
  publishChannelChange(change);
  return true;
}

/** Privately wake agents for due follow-ups, routines, and task check-ins. Claims commit before delivery. */
export async function wakeDueChannelAgents(now = new Date()): Promise<void> {
  try {
    const database = await getStateDatabase();
    const { followUps, routines, checkIns, taskChanges } = await new ChannelDatabase(
      database,
    ).claimDueWakes(now);
    for (const change of [...followUps.map(({ change }) => change), ...taskChanges])
      publishChannelChange(change);
    await Promise.all([
      ...followUps.map(({ agentId, waitingFor }) =>
        wakeQuietly(agentId, { type: "channel_follow_up", waitingFor }),
      ),
      ...routines.map(({ channelId, title, prompt }) =>
        wakeQuietly(channelId, { type: "channel_routine", title, prompt }),
      ),
      ...checkIns.map(({ agentId, ...task }) =>
        wakeQuietly(agentId, { type: "channel_task_check_in", ...task }),
      ),
    ]);
  } catch (error) {
    console.error("Failed to wake due Channel agents:", error);
  }
}

/** Privately wakes another Channel's lead with a message that names the sender's Channel. */
export async function messageChannelLead(
  fromChannelId: string,
  { channelId, content }: { channelId: string; content: string },
): Promise<void> {
  if (channelId === fromChannelId) throw new Error("Message another channel's lead, not your own.");
  const database = new ChannelDatabase(await getStateDatabase());
  // Delivery accepts any Session, so the target must be a Channel and therefore its lead.
  const [sender, target] = await Promise.all([
    database.getChannel(fromChannelId),
    database.getChannel(channelId),
  ]);
  if (!sender || !target) throw new Error("Channel not found.");
  await wakeChannelAgent(channelId, {
    type: "channel_lead_message",
    channelId: sender.id,
    channelName: sender.name,
    content,
  });
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

function wakeQuietly(agentId: string, systemMessage: SessionSystemMessage): Promise<void> {
  return wakeChannelAgent(agentId, systemMessage).catch((error) => {
    console.error(`Failed to wake Channel agent ${agentId}:`, error);
  });
}

async function assertMedia(path: string): Promise<void> {
  if (!isAbsolute(path))
    throw new Error("Use an absolute attachment path when this Session has no workspace.");
  const file = Bun.file(path);
  if (!(await file.exists()) || !/^(image|video)\//.test(file.type)) {
    throw new Error(`Channel attachment is not an image or video file: ${path}`);
  }
}

/** A relative path resolves against the Channel's directory. */
export async function shareChannelArtifact(
  { channelId, path, title }: { channelId: string; path: string; title: string },
  actor: ChannelMessageActor,
) {
  const database = new ChannelDatabase(await getStateDatabase());
  const channel = await database.getChannel(channelId);
  if (!channel) throw new Error("Channel not found.");
  const absolutePath = isAbsolute(path)
    ? resolve(path)
    : channel.directory
      ? resolve(channel.directory, path)
      : undefined;
  if (!absolutePath || !(await Bun.file(absolutePath).exists())) {
    throw new Error("Share an existing file using an absolute or workspace-relative path.");
  }
  const result = await database.shareArtifact({
    channelId,
    file: workspaceFileFromAbsolutePath(absolutePath),
    title,
    actor,
  });
  publishChannelChange(result);
  return result.artifact;
}

export async function detachChannelAgentSession(sessionId: string): Promise<void> {
  const database = new ChannelDatabase(await getStateDatabase());
  const change = await database.deleteMember(sessionId, { type: "user" });
  if (!change) return;
  publishChannelChange(change);
}

export async function requireChannelAgent(agentId: string) {
  const agent = await new ChannelDatabase(await getStateDatabase()).getAgent(agentId);
  if (!agent) throw new Error("This agent session does not belong to a channel.");
  return agent;
}

/**
 * Publish the committed detail events and their catalog projections together. Call it
 * in the commit's continuation with no I/O or timer between: transactions resolve in commit
 * order, so publication follows it, and streams rely on that order instead of repairing it.
 */
export function publishChannelChange({ channelId, events, channel }: ChannelChange): void {
  if (events.length === 0) return;
  for (const event of events) {
    publishChannelEvent(channelId, event);
    if (channel && event.type === "message") publishChannelNotification(channel, event.message);
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
  if (channel) broadcast({ type: "channel.upserted", channel: catalogEntry(channel) });
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
