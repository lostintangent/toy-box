import {
  agentHandleFromName,
  channelAgentMetadataSchema,
  isChannelSystemMessage,
  channelTaskSchema,
  channelTasksComplete,
  channelSystemMessageContentSchema,
  CHANNEL_LEAD_PROFILE,
  unassignChannelTasks,
  type Channel,
  type ChannelEvent as ClientChannelEvent,
  type ChannelChanges,
  type ChannelMessageActor,
  type ChannelMemberChanges,
  type ChannelAgentStatus,
  type ChannelArtifact,
  type ChannelList,
  channelMemberIdentity,
  type ChannelMember,
  type ChannelMessage as ClientChannelMessage,
  type ChannelConversationMessage as ClientConversationMessage,
  type ChannelReaction,
  type ChannelMessageSender,
  type ChannelSystemMessageContent,
  type ChannelTask,
  type ChannelRoutine,
  type CreateChannelInput,
  type EditChannelInput,
  type SetChannelRoutineInput,
  type UpdateChannelInput,
} from "@channels/model";
import { reduceChannel } from "@channels/model/reducer";
import { machineFile, sessionFile } from "@files/model";
import { modelConfigurationSchema } from "@providers/model";
import { inStateTransaction } from "@/server/database";
import { nextCronOccurrence } from "@/shared/cron";
import type { Worker } from "@workers/model";
import { WorkerDatabase } from "@workers/server/database";
import {
  channelAgentFromWorker,
  channelMemberFromWorker,
  channelMembersFromWorkers,
  channelRoster,
  isChannelLead,
} from "@channels/model/worker";

import { z } from "zod";
import { attachmentSchema } from "@/shared/attachments/model";

const channelAttachmentSchema = z.union([attachmentSchema, z.string().min(1).max(4_096)]);
export type StoredAttachment = z.output<typeof channelAttachmentSchema>;
export type StoredChannelMessage = ClientChannelMessage<StoredAttachment>;
type ChannelMessage = StoredChannelMessage;
type ChannelConversationMessage = ClientConversationMessage<StoredAttachment>;
type ChannelEvent = ClientChannelEvent<StoredAttachment>;

/** A committed public change; catalog metadata is present only when it changed. */
export type ChannelChange = {
  channelId: string;
  events: readonly ChannelEvent[];
  channel?: Channel;
};

/** Durable Channels, ordered messages, agent read positions, and shared file references. */
export class ChannelDatabase {
  constructor(private readonly db: Bun.SQL) {}

  async listChannels(): Promise<ChannelList> {
    const [rows, workers] = await Promise.all([
      readChannelRows(this.db),
      new WorkerDatabase(this.db).list("channel"),
    ]);
    const channelIds = new Set(rows.map(({ id }) => id));
    return {
      channels: rows.map(channelFromRow),
      members: workers.flatMap((worker) =>
        !channelIds.has(worker.channelId) || isChannelLead(worker)
          ? []
          : [channelMemberIdentity(channelMemberFromWorker(worker))],
      ),
    };
  }

  async createChannel(
    input: CreateChannelInput,
    lead: Extract<Worker, { type: "channel" }>,
  ): Promise<Channel> {
    const id = lead.sessionId;
    return inStateTransaction(this.db, async (db) => {
      await db`
        INSERT INTO channels ${db({
          id,
          ...channelColumns({ ...input, tasks: [] }),
          updated_at: lead.createdAt,
        })}
      `;
      await new WorkerDatabase(db).create(lead);
      return requireChannel(db, id);
    });
  }

  async getChannel(channelId: string): Promise<Channel | null> {
    const [row] = await readChannelRows(this.db, channelId);
    return row ? channelFromRow(row) : null;
  }

  async editChannel({ channelId, ...changes }: EditChannelInput) {
    return inStateTransaction(this.db, async (db) => {
      const channel = await requireChannel(db, channelId);
      return updateChannelFields(db, channel, changes, { type: "user" });
    });
  }

  async deleteChannel(channelId: string): Promise<string[] | null> {
    return inStateTransaction(this.db, async (db) => {
      const workerDatabase = new WorkerDatabase(db);
      const workers = await workerDatabase.list({ type: "channel", channelId });
      for (const worker of workers) await workerDatabase.delete(worker.sessionId);
      const rows = await db<{ id: string }[]>`
        DELETE FROM channels WHERE id = ${channelId} RETURNING id
      `;
      return rows.length ? workers.map(({ sessionId }) => sessionId) : null;
    });
  }

  async markUserSeen(channelId: string, sequence: number) {
    return inStateTransaction(this.db, async (db) => {
      const [row] = await db<ChannelRow[]>`
        UPDATE channels
        SET seen_through = MIN(latest_sequence, MAX(seen_through, ${sequence})),
          revision = revision + 1
        WHERE id = ${channelId} AND seen_through < MIN(latest_sequence, ${sequence})
        RETURNING *
      `;
      if (!row) return null;
      const channel = channelFromRow(row);
      return {
        channelId,
        channel,
        events: [
          {
            type: "read" as const,
            revision: row.revision,
            seenThrough: channel.seenThrough,
          },
        ],
      };
    });
  }

  /** The transcript, human cursor, and pending request describe the same durable instant. */
  async getSnapshot(channelId: string, messageLimit: number) {
    return inStateTransaction(this.db, async (db) => {
      const [row] = await readChannelRows(db, channelId);
      if (!row) return null;
      const channel = channelFromRow(row);
      return {
        channel,
        request:
          channel.requestSequence === null
            ? null
            : await readRequest(db, channelId, channel.requestSequence),
        revision: row.revision,
        ...channelRoster(await new WorkerDatabase(db).list({ type: "channel", channelId })),
        messages: await listMessagesBefore(db, channelId, undefined, messageLimit),
        artifacts: await listArtifacts(db, channelId),
        routines: await listRoutines(db, channelId),
      };
    });
  }

  /** An atomic replay position and presence inputs, without reading public history. */
  async getRoster(channelId: string) {
    return inStateTransaction(this.db, async (db) => {
      const [channel] = await db<{ revision: number }[]>`
        SELECT revision FROM channels WHERE id = ${channelId}
      `;
      if (!channel) return null;
      return {
        revision: channel.revision,
        ...channelRoster(await new WorkerDatabase(db).list({ type: "channel", channelId })),
      };
    });
  }

  async listMembers(channelId: string): Promise<ChannelMember[]> {
    return channelMembersFromWorkers(
      await new WorkerDatabase(this.db).list({ type: "channel", channelId }),
    );
  }

  async getMember(agentId: string) {
    const agent = await getAgent(this.db, agentId);
    return agent?.isLead ? null : agent;
  }

  async getAgent(agentId: string) {
    return getAgent(this.db, agentId);
  }

  async createMember(worker: Extract<Worker, { type: "channel" }>) {
    return inStateTransaction(this.db, async (db) => {
      const channel = await requireChannel(db, worker.channelId);
      await assertMemberNameAvailable(db, worker.channelId, worker.name);
      await new WorkerDatabase(db).create(worker);
      const member = channelMemberFromWorker(worker);
      const change = await appendSystemMessage(db, worker.channelId, {
        type: "member_joined",
        member,
      });
      return { ...(await recordChannelChange(db, channel, [change])), member };
    });
  }

  async updateMember(agentId: string, changes: ChannelMemberChanges) {
    return inStateTransaction(this.db, async (db) => {
      const worker = await requireChannelMemberWorker(db, agentId);
      const { name = worker.name, ...profile } = changes;
      const current = channelAgentMetadataSchema.parse(worker.metadata);
      const metadata = applyPatch(current, profile);
      const member = channelMemberFromWorker({ ...worker, name }, metadata);
      if (name === worker.name && Bun.deepEquals(metadata, current)) {
        return { channelId: worker.channelId, events: [], member };
      }
      if (name !== worker.name) {
        await assertMemberNameAvailable(db, worker.channelId, name, worker.sessionId);
      }
      await new WorkerDatabase(db).update(worker.sessionId, { name, metadata });
      return {
        member,
        channelId: worker.channelId,
        events: [
          {
            type: "member" as const,
            member,
            revision: await advanceRevision(db, worker.channelId),
          },
        ],
      };
    });
  }

  async markAgentSeen(agentId: string, sequence: number): Promise<void> {
    await inStateTransaction(this.db, async (db) => {
      const worker = await requireChannelWorker(db, agentId);
      const metadata = channelAgentMetadataSchema.parse(worker.metadata);
      if (metadata.seenThrough >= sequence) return;
      await new WorkerDatabase(db).update(worker.sessionId, {
        metadata: { ...metadata, seenThrough: sequence },
      });
    });
  }

  async setAgentStatus(agentId: string, status?: ChannelAgentStatus, required = true) {
    return changeAgentStatus(this.db, agentId, status, required);
  }

  async clearAgentStatus(agentId: string, state: ChannelAgentStatus["state"]) {
    return changeAgentStatus(this.db, agentId, undefined, false, state);
  }

  async updateChannel(leadId: string, input: UpdateChannelInput) {
    return inStateTransaction(this.db, async (db) => {
      const channel = await requireLeadChannel(db, leadId);
      if (input.tasks) {
        const agentIds = new Set(
          (await new WorkerDatabase(db).list({ type: "channel", channelId: channel.id })).map(
            ({ sessionId }) => sessionId,
          ),
        );
        assertTaskOwners(input.tasks, agentIds);
      }
      return updateChannelFields(db, channel, input, { type: "agent", agentId: leadId });
    });
  }

  async deleteMember(agentId: string) {
    return inStateTransaction(this.db, async (db) => {
      const workers = new WorkerDatabase(db);
      const worker = await workers.get(agentId, "channel");
      if (!worker || isChannelLead(worker)) return null;
      const member = channelMemberFromWorker(worker);
      if (!(await workers.delete(agentId))) return null;
      const channel = await requireChannel(db, member.channelId);
      const { tasks } = channel;
      const unassigned = unassignChannelTasks(tasks, agentId);
      if (!Bun.deepEquals(unassigned, tasks)) {
        await db`
          UPDATE channels SET tasks = ${JSON.stringify(unassigned)} WHERE id = ${member.channelId}
        `;
      }
      const change = await appendSystemMessage(db, member.channelId, {
        type: "member_left",
        member,
      });
      return { ...(await recordChannelChange(db, channel, [change])), member };
    });
  }

  async listAgentIds(channelId: string): Promise<string[]> {
    return (await new WorkerDatabase(this.db).list({ type: "channel", channelId }))
      .map(({ sessionId }) => sessionId)
      .sort();
  }

  async listMessagesAfter(
    channelId: string,
    afterSequence = 0,
    limit?: number,
  ): Promise<ChannelMessage[]> {
    const rows = await this.db<ChannelMessageRow[]>`
      SELECT * FROM channel_messages
      WHERE channel_id = ${channelId} AND sequence > ${afterSequence}
      ORDER BY sequence
      LIMIT ${limit ?? -1}
    `;
    return hydrateMessages(this.db, channelId, rows);
  }

  async listMessagesBefore(
    channelId: string,
    beforeSequence?: number,
    limit = 100,
  ): Promise<ChannelMessage[]> {
    return listMessagesBefore(this.db, channelId, beforeSequence, limit);
  }

  /** History and reactions share a revision, so clients can reject an overtaken page. */
  async getHistory(channelId: string, beforeSequence: number) {
    return inStateTransaction(this.db, async (db) => {
      const [channel] = await db<{ revision: number }[]>`
        SELECT revision FROM channels WHERE id = ${channelId}
      `;
      return channel
        ? {
            revision: channel.revision,
            messages: await listMessagesBefore(db, channelId, beforeSequence),
          }
        : null;
    });
  }

  /** Appends a user or Agent message. The lead can flag its own message as a request for the user. */
  async appendMessage({
    channelId,
    attachments,
    request,
    ...message
  }: Omit<ChannelConversationMessage, "sequence" | "timestamp" | "reactions" | "request"> & {
    channelId: string;
    request?: boolean;
  }) {
    // A lead's Agent ID is its Channel's ID.
    if (request && !(message.sender.type === "agent" && message.sender.agentId === channelId)) {
      throw new Error("Only the channel lead can request input.");
    }
    return inStateTransaction(this.db, async (db) => {
      const channel = await requireChannel(db, channelId);
      const acknowledgedRequest =
        message.sender.type === "user" && channel.requestSequence !== null;
      const change = await appendMessage(db, channelId, (position) => ({
        ...message,
        ...position,
        ...(request ? { request: true as const } : {}),
        ...(attachments?.length ? { attachments } : {}),
      }));
      return {
        ...(await recordChannelChange(db, channel, [change])),
        message: change.message,
        acknowledgedRequest,
      };
    });
  }

  async setMessageReaction(input: {
    channelId: string;
    sequence: number;
    agentId: string;
    reaction: ChannelReaction["reaction"] | null;
  }) {
    return inStateTransaction(this.db, async (db) => {
      let reaction: ChannelReaction | null;
      if (input.reaction === null) {
        const rows = await db<{ agent_id: string }[]>`
          DELETE FROM channel_message_reactions
          WHERE channel_id = ${input.channelId}
            AND message_sequence = ${input.sequence}
            AND agent_id = ${input.agentId}
          RETURNING agent_id
        `;
        if (rows.length === 0) return null;
        reaction = null;
      } else {
        const [row] = await db<{ agent_id: string }[]>`
          INSERT INTO channel_message_reactions (
            channel_id, message_sequence, agent_id, reaction
          )
          SELECT ${input.channelId}, ${input.sequence}, ${input.agentId}, ${input.reaction}
          FROM channel_messages
          WHERE channel_id = ${input.channelId}
            AND sequence = ${input.sequence}
            AND sender_type <> 'system'
          ON CONFLICT(channel_id, message_sequence, agent_id)
          DO UPDATE SET reaction = excluded.reaction
          RETURNING agent_id
        `;
        if (!row) throw new Error("React to a user or Agent message in this Channel.");
        reaction = { agentId: row.agent_id, reaction: input.reaction };
      }
      return {
        channelId: input.channelId,
        reaction,
        events: [
          {
            type: "reaction" as const,
            sequence: input.sequence,
            agentId: input.agentId,
            reaction: input.reaction,
            revision: await advanceRevision(db, input.channelId),
          },
        ],
      };
    });
  }

  async listArtifacts(channelId: string): Promise<ChannelArtifact[]> {
    return listArtifacts(this.db, channelId);
  }

  async shareArtifact(input: {
    channelId: string;
    file: ChannelArtifact["file"];
    title: string;
    actor: Extract<ChannelSystemMessageContent, { type: "artifact_shared" }>["actor"];
  }) {
    return inStateTransaction(this.db, async (db) => {
      const [row] = await db<ChannelArtifactRow[]>`
        INSERT INTO channel_artifacts (
          channel_id, kind, session_id, path, title, created_at
        ) VALUES (
          ${input.channelId}, ${input.file.kind},
          ${input.file.kind === "session" ? input.file.sessionId : null},
          ${input.file.path}, ${input.title}, ${new Date().toISOString()}
        )
        ON CONFLICT DO UPDATE SET title = excluded.title
        WHERE channel_artifacts.title <> excluded.title
        RETURNING kind, session_id, path, title, created_at
      `;
      if (!row)
        return {
          channelId: input.channelId,
          events: [],
          artifact: { file: input.file, title: input.title },
        };
      const channel = await requireChannel(db, input.channelId);
      const artifact = artifactFromRow(row);
      const change = await appendSystemMessage(db, input.channelId, {
        type: "artifact_shared",
        actor: input.actor,
        artifact: { file: artifact.file, title: artifact.title },
      });
      return { ...(await recordChannelChange(db, channel, [change])), artifact };
    });
  }

  async listRoutines(channelId: string): Promise<ChannelRoutine[]> {
    return listRoutines(this.db, channelId);
  }

  /** Adds a routine to the lead's Channel, or changes one. An identical change is a no-op. */
  async setRoutine(leadId: string, { routineId, ...input }: SetChannelRoutineInput) {
    return inStateTransaction(this.db, async (db) => {
      const channel = await requireLeadChannel(db, leadId);
      const routine = { id: routineId ?? crypto.randomUUID(), ...input };
      const nextAt = nextCronOccurrence(input.schedule, new Date()).toISOString();
      if (routineId) {
        const [current] = await db<ChannelRoutine[]>`
          SELECT id, title, schedule, prompt FROM channel_routines
          WHERE id = ${routineId} AND channel_id = ${channel.id}
        `;
        if (!current) throw new Error("Routine not found in this channel.");
        if (Bun.deepEquals(current, routine)) {
          return { channelId: channel.id, events: [], routine };
        }
        await db`
          UPDATE channel_routines SET ${db({ ...input, next_at: nextAt })} WHERE id = ${routineId}
        `;
      } else {
        await db`
          INSERT INTO channel_routines ${db({
            ...routine,
            channel_id: channel.id,
            next_at: nextAt,
            created_at: new Date().toISOString(),
          })}
        `;
      }
      const change = await appendSystemMessage(db, channel.id, {
        type: routineId ? "routine_edited" : "routine_scheduled",
        routine,
      });
      return { ...(await recordChannelChange(db, channel, [change])), routine };
    });
  }

  /** Deletes a routine, or returns null when it's already gone. */
  async deleteRoutine(channelId: string, routineId: string) {
    return inStateTransaction(this.db, async (db) => {
      const [row] = await db<ChannelRoutine[]>`
        DELETE FROM channel_routines WHERE id = ${routineId} AND channel_id = ${channelId}
        RETURNING id, title, schedule, prompt
      `;
      if (!row) return null;
      const channel = await requireChannel(db, channelId);
      const change = await appendSystemMessage(db, channelId, {
        type: "routine_deleted",
        routine: row,
      });
      return recordChannelChange(db, channel, [change]);
    });
  }

  /**
   * Claims every due follow-up and routine, so each wakes its lead once. A follow-up clears its
   * waiting status. A routine moves past `now`, so runs missed while stopped collapse into one.
   */
  async claimDueWakes(now: Date) {
    return inStateTransaction(this.db, async (db) => {
      const workers = new WorkerDatabase(db);
      const followUps = [];
      for (const worker of await workers.list("channel")) {
        const metadata = channelAgentMetadataSchema.parse(worker.metadata);
        const { status } = metadata;
        if (status?.state !== "waiting" || !status.wakeAt || new Date(status.wakeAt) > now)
          continue;
        await workers.update(worker.sessionId, {
          metadata: applyPatch(metadata, { status: null }),
        });
        const revision = await advanceRevision(db, worker.channelId);
        followUps.push({
          agentId: worker.sessionId,
          change: {
            channelId: worker.channelId,
            events: [{ type: "status" as const, agentId: worker.sessionId, revision }],
          },
          waitingFor: status.text,
        });
      }
      const routines = await db<(ChannelRoutine & { channel_id: string })[]>`
        SELECT id, channel_id, title, schedule, prompt FROM channel_routines
        WHERE next_at <= ${now.toISOString()}
      `;
      for (const { id, schedule } of routines) {
        await db`
          UPDATE channel_routines
          SET next_at = ${nextCronOccurrence(schedule, now).toISOString()}
          WHERE id = ${id}
        `;
      }
      return {
        followUps,
        routines: routines.map(({ channel_id, title, prompt }) => ({
          channelId: channel_id,
          title,
          prompt,
        })),
      };
    });
  }
}

/** Undefined leaves a property alone; null removes an optional property. */
function applyPatch<Value extends object>(
  current: Value,
  changes: { [Key in keyof Value]?: Value[Key] | null },
): Value {
  const next = { ...current };
  for (const key in changes) {
    const value = changes[key];
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  return next;
}

async function advanceRevision(db: Bun.SQL, channelId: string): Promise<number> {
  const [channel] = await db<Pick<ChannelRow, "revision">[]>`
    UPDATE channels SET revision = revision + 1 WHERE id = ${channelId} RETURNING revision
  `;
  if (!channel) throw new Error("Channel not found.");
  return channel.revision;
}

/** Fold this transaction's events into metadata and persist their attention cursors. */
async function recordChannelChange<Event extends ChannelEvent>(
  db: Bun.SQL,
  previous: Channel,
  events: Event[],
) {
  const channel = events.reduce(reduceChannel, previous);
  if (
    channel.requestSequence !== previous.requestSequence ||
    channel.completedSequence !== previous.completedSequence
  ) {
    await db`
      UPDATE channels
      SET request_sequence = ${channel.requestSequence},
        completed_sequence = ${channel.completedSequence}
      WHERE id = ${channel.id}
    `;
  }
  return { channelId: channel.id, events, channel };
}

async function updateChannelFields(
  db: Bun.SQL,
  current: Channel,
  changes: ChannelChanges,
  actor: ChannelMessageActor,
) {
  if (changes.model && changes.model.provider !== current.model.provider) {
    throw new Error("The lead's provider cannot change without losing its session history.");
  }
  const next = applyPatch(current, changes);
  const events: ChannelEvent[] = [];
  if (Bun.deepEquals(next, current)) {
    return { ...(await recordChannelChange(db, current, events)), purposeChanged: false };
  }
  const updates: ChannelSystemMessageContent[] = [];
  if (next.name !== current.name) updates.push({ type: "channel_renamed", actor, name: next.name });
  if (next.purpose !== current.purpose)
    updates.push({ type: "channel_purpose_changed", actor, purpose: next.purpose ?? null });
  if (next.directory !== current.directory)
    updates.push({ type: "channel_directory_changed", actor, directory: next.directory ?? null });
  if (next.previewUrl !== current.previewUrl)
    updates.push({ type: "preview_changed", actor, previewUrl: next.previewUrl ?? null });
  if (!channelTasksComplete(current.tasks) && channelTasksComplete(next.tasks))
    updates.push({ type: "tasks_completed" });
  // User edits count as activity; task revisions alone stay quiet.
  const updatedAt = actor.type === "user" ? new Date().toISOString() : current.updatedAt;
  await db`
    UPDATE channels SET ${db({
      ...channelColumns(next),
      updated_at: updatedAt,
    })}
    WHERE id = ${current.id}
  `;
  if (!Bun.deepEquals(next.tasks, current.tasks)) {
    events.push({
      type: "tasks",
      revision: await advanceRevision(db, current.id),
      tasks: next.tasks,
    });
  }
  if (!Bun.deepEquals(next.model, current.model)) {
    events.push({
      type: "model",
      revision: await advanceRevision(db, current.id),
      model: next.model,
      updatedAt,
    });
  }
  for (const content of updates) {
    events.push(await appendSystemMessage(db, current.id, content));
  }
  return {
    ...(await recordChannelChange(db, current, events)),
    purposeChanged: next.purpose !== current.purpose,
  };
}

function channelColumns(
  channel: Pick<Channel, "name" | "purpose" | "directory" | "model" | "tasks" | "previewUrl">,
) {
  return {
    name: channel.name,
    purpose: channel.purpose ?? null,
    directory: channel.directory ?? null,
    model: JSON.stringify(channel.model),
    tasks: JSON.stringify(channel.tasks),
    preview_url: channel.previewUrl ?? null,
  };
}

function appendSystemMessage(db: Bun.SQL, channelId: string, content: ChannelSystemMessageContent) {
  return appendMessage(db, channelId, (position) => ({
    ...position,
    id: crypto.randomUUID(),
    sender: { type: "system" },
    content,
  }));
}

async function appendMessage<Message extends ChannelMessage>(
  db: Bun.SQL,
  channelId: string,
  build: (position: Pick<ChannelMessage, "sequence" | "timestamp">) => Message,
) {
  const now = new Date().toISOString();
  const [channel] = await db<Pick<ChannelRow, "latest_sequence" | "revision">[]>`
    UPDATE channels
    SET
      latest_sequence = latest_sequence + 1,
      revision = revision + 1,
      updated_at = ${now}
    WHERE id = ${channelId}
    RETURNING latest_sequence, revision
  `;
  if (!channel) throw new Error("Channel not found.");
  const message = build({
    sequence: channel.latest_sequence,
    timestamp: now,
  });
  await db`
    INSERT INTO channel_messages ${db({ channel_id: channelId, ...messageColumns(message) })}
  `;
  return {
    type: "message" as const,
    message,
    revision: channel.revision,
  };
}

function messageColumns(message: ChannelMessage) {
  return {
    id: message.id,
    sequence: message.sequence,
    timestamp: message.timestamp,
    sender_type: message.sender.type,
    sender_agent_id: message.sender.type === "agent" ? message.sender.agentId : null,
    content:
      typeof message.content === "string" ? message.content : JSON.stringify(message.content),
    attachments: message.attachments?.length ? JSON.stringify(message.attachments) : null,
    request: message.request ? 1 : 0,
  };
}

async function changeAgentStatus(
  db: Bun.SQL,
  agentId: string,
  status: ChannelAgentStatus | undefined,
  required: boolean,
  requiredState?: ChannelAgentStatus["state"],
) {
  return inStateTransaction(db, async (transaction) => {
    const worker = await new WorkerDatabase(transaction).get(agentId, "channel");
    if (!worker) {
      if (required) throw new Error("Channel agent not found.");
      return null;
    }
    const metadata = channelAgentMetadataSchema.parse(worker.metadata);
    if (requiredState && metadata.status?.state !== requiredState) return null;
    if (Bun.deepEquals(metadata.status, status)) return null;
    await new WorkerDatabase(transaction).update(worker.sessionId, {
      metadata: applyPatch(metadata, { status: status ?? null }),
    });
    return {
      channelId: worker.channelId,
      events: [
        {
          type: "status" as const,
          agentId,
          status,
          revision: await advanceRevision(transaction, worker.channelId),
        },
      ],
    };
  });
}

async function getAgent(db: Bun.SQL, agentId: string) {
  const worker = await new WorkerDatabase(db).get(agentId, "channel");
  if (!worker) return null;
  return channelAgentFromWorker(worker);
}

/** Request content is retained even when its message has left the snapshot window. */
async function readRequest(
  db: Bun.SQL,
  channelId: string,
  sequence: number,
): Promise<ChannelConversationMessage | null> {
  const rows = await db<ChannelMessageRow[]>`
    SELECT * FROM channel_messages WHERE channel_id = ${channelId} AND sequence = ${sequence}
  `;
  const message = (await hydrateMessages(db, channelId, rows))[0];
  return message && !isChannelSystemMessage(message) ? message : null;
}

async function listMessagesBefore(
  db: Bun.SQL,
  channelId: string,
  beforeSequence?: number,
  limit = 100,
): Promise<ChannelMessage[]> {
  const before = beforeSequence ?? Number.MAX_SAFE_INTEGER;
  const rows = await db<ChannelMessageRow[]>`
    SELECT * FROM channel_messages
    WHERE channel_id = ${channelId} AND sequence < ${before}
    ORDER BY sequence DESC
    LIMIT ${limit}
  `;
  return hydrateMessages(db, channelId, rows.reverse());
}

async function hydrateMessages(
  db: Bun.SQL,
  channelId: string,
  rows: ChannelMessageRow[],
): Promise<ChannelMessage[]> {
  const firstSequence = rows[0]?.sequence;
  const lastSequence = rows.at(-1)?.sequence;
  if (firstSequence === undefined || lastSequence === undefined) return [];
  const reactionRows = await db<ChannelReactionRow[]>`
    SELECT message_sequence, agent_id, reaction FROM channel_message_reactions
    WHERE channel_id = ${channelId}
      AND message_sequence >= ${firstSequence}
      AND message_sequence <= ${lastSequence}
    ORDER BY message_sequence, agent_id
  `;
  const reactions = reactionsByMessage(reactionRows);
  return rows.map((row) => messageFromRow(row, reactions.get(row.sequence) ?? []));
}

async function listArtifacts(db: Bun.SQL, channelId: string): Promise<ChannelArtifact[]> {
  const rows = await db<ChannelArtifactRow[]>`
    SELECT kind, session_id, path, title, created_at FROM channel_artifacts
    WHERE channel_id = ${channelId}
    ORDER BY created_at, kind, session_id, path
  `;
  return rows.map(artifactFromRow);
}

async function listRoutines(db: Bun.SQL, channelId: string): Promise<ChannelRoutine[]> {
  return db<ChannelRoutine[]>`
    SELECT id, title, schedule, prompt FROM channel_routines
    WHERE channel_id = ${channelId}
    ORDER BY created_at, id
  `;
}

type ChannelRow = {
  id: string;
  name: string;
  purpose: string | null;
  directory: string | null;
  model: string;
  tasks: string;
  preview_url: string | null;
  latest_sequence: number;
  revision: number;
  seen_through: number;
  request_sequence: number | null;
  completed_sequence: number | null;
  updated_at: string;
};

type ChannelMessageRow = {
  id: string;
  channel_id: string;
  sequence: number;
  sender_type: ChannelMessageSender["type"];
  sender_agent_id: string | null;
  content: string;
  request: number;
  attachments: string | null;
  timestamp: string;
};

type ChannelReactionRow = {
  message_sequence: number;
  agent_id: string;
  reaction: ChannelReaction["reaction"];
};

type ChannelArtifactRow = { path: string; title: string; created_at: string } & (
  | { kind: "session"; session_id: string }
  | { kind: "machine"; session_id: null }
);

async function readChannelRows(db: Bun.SQL, channelId?: string) {
  const where = channelId === undefined ? db`` : db`WHERE id = ${channelId}`;
  return db<ChannelRow[]>`
    SELECT * FROM channels
    ${where}
    ORDER BY updated_at DESC, id
  `;
}

function channelFromRow(row: ChannelRow): Channel {
  return {
    id: row.id,
    name: row.name,
    ...(row.purpose ? { purpose: row.purpose } : {}),
    ...(row.directory ? { directory: row.directory } : {}),
    model: modelConfigurationSchema.parse(JSON.parse(row.model)),
    tasks: channelTaskSchema.array().parse(JSON.parse(row.tasks)),
    ...(row.preview_url ? { previewUrl: row.preview_url } : {}),
    latestSequence: row.latest_sequence,
    seenThrough: row.seen_through,
    completedSequence: row.completed_sequence,
    requestSequence: row.request_sequence,
    updatedAt: row.updated_at,
  };
}

async function requireChannelWorker(
  db: Bun.SQL,
  sessionId: string,
): Promise<Extract<Worker, { type: "channel" }>> {
  const worker = await new WorkerDatabase(db).get(sessionId, "channel");
  if (!worker) throw new Error("Channel agent not found.");
  return worker;
}

async function requireChannelMemberWorker(
  db: Bun.SQL,
  sessionId: string,
): Promise<Extract<Worker, { type: "channel" }>> {
  const worker = await requireChannelWorker(db, sessionId);
  if (isChannelLead(worker)) throw new Error("Channel member not found.");
  return worker;
}

async function requireChannel(db: Bun.SQL, channelId: string): Promise<Channel> {
  const [row] = await readChannelRows(db, channelId);
  if (!row) throw new Error("Channel not found.");
  return channelFromRow(row);
}

async function requireLeadChannel(db: Bun.SQL, leadId: string): Promise<Channel> {
  const [row] = await readChannelRows(db, leadId);
  if (!row) throw new Error("Only the channel lead can update the channel.");
  return channelFromRow(row);
}

async function assertMemberNameAvailable(
  db: Bun.SQL,
  channelId: string,
  name: string | undefined,
  exceptSessionId?: string,
): Promise<void> {
  if (!name) throw new Error("Channel members require a name.");
  const handle = agentHandleFromName(name);
  if (handle === agentHandleFromName(CHANNEL_LEAD_PROFILE.name)) {
    throw new Error(`The intrinsic lead already uses the @${handle} mention.`);
  }
  const workers = await new WorkerDatabase(db).list({ type: "channel", channelId });
  const conflict = workers.find(
    (worker) =>
      !isChannelLead(worker) &&
      worker.sessionId !== exceptSessionId &&
      worker.name &&
      agentHandleFromName(worker.name) === handle,
  );
  if (conflict) throw new Error(`${conflict.name} already uses the @${handle} mention.`);
}

function artifactFromRow(row: ChannelArtifactRow): ChannelArtifact {
  return {
    file: row.kind === "session" ? sessionFile(row.session_id, row.path) : machineFile(row.path),
    title: row.title,
    sharedAt: row.created_at,
  };
}

function messageFromRow(row: ChannelMessageRow, reactions: ChannelReaction[]): ChannelMessage {
  const common = {
    id: row.id,
    sequence: row.sequence,
    timestamp: row.timestamp,
  };
  if (row.sender_type === "system") {
    return {
      ...common,
      sender: { type: "system" },
      content: channelSystemMessageContentSchema.parse(JSON.parse(row.content)),
    };
  }

  const attachments = row.attachments
    ? channelAttachmentSchema.array().parse(JSON.parse(row.attachments))
    : undefined;
  const sender: Exclude<ChannelMessageSender, { type: "system" }> =
    row.sender_type === "user"
      ? { type: "user" }
      : { type: "agent", agentId: row.sender_agent_id! };
  return {
    ...common,
    sender,
    content: row.content,
    ...(row.request ? { request: true as const } : {}),
    ...(attachments?.length ? { attachments } : {}),
    ...(reactions.length ? { reactions } : {}),
  };
}

function reactionsByMessage(rows: ChannelReactionRow[]): Map<number, ChannelReaction[]> {
  const reactions = new Map<number, ChannelReaction[]>();
  for (const row of rows) {
    const messageReactions = reactions.get(row.message_sequence) ?? [];
    messageReactions.push({ agentId: row.agent_id, reaction: row.reaction });
    reactions.set(row.message_sequence, messageReactions);
  }
  return reactions;
}

function assertTaskOwners(tasks: readonly ChannelTask[], agentIds: ReadonlySet<string>): void {
  for (const task of tasks) {
    if (task.ownerId && !agentIds.has(task.ownerId)) {
      throw new Error("Task owners must be the channel lead or a current member.");
    }
    if (task.children) assertTaskOwners(task.children, agentIds);
  }
}
