import {
  agentHandleFromName,
  channelAttachmentSchema,
  channelAgentMetadataSchema,
  channelCompletionBlockers,
  channelChecklistItemSchema,
  channelSystemMessageContentSchema,
  CHANNEL_LEAD_PROFILE,
  unassignChannelChecklist,
  type Channel,
  type ChannelChanges,
  type ChannelMessageActor,
  type ChannelMemberChanges,
  type ChannelAgentStatus,
  type ChannelArtifact,
  type ChannelList,
  type ChannelMember,
  type ChannelMessage,
  type ChannelConversationMessage,
  type ChannelReaction,
  type ChannelMessageSender,
  type ChannelState,
  type ChannelSystemMessageContent,
  type ChannelSystemMessage,
  type ChannelChecklistItem,
  type CreateChannelInput,
  type EditChannelInput,
  type UpdateChannelInput,
} from "@channels/model";
import { machineFile, sessionFile } from "@files/model";
import { modelConfigurationSchema } from "@providers/model";
import { inStateTransaction } from "@/server/database";
import type { Worker } from "@workers/model";
import { WorkerDatabase } from "@workers/server/database";
import {
  channelAgentFromWorker,
  channelMemberFromWorker,
  channelMembersFromWorkers,
  channelRoster,
  isChannelLead,
} from "@channels/model/worker";

/** Durable Channels, ordered messages, agent read positions, and shared file references. */
export class ChannelDatabase {
  constructor(private readonly db: Bun.SQL) {}

  async listChannels(): Promise<ChannelList> {
    const [channels, workers] = await Promise.all([
      readChannels(this.db),
      new WorkerDatabase(this.db).list("channel"),
    ]);
    const channelIds = new Set(channels.map(({ id }) => id));
    return {
      channels,
      members: workers.flatMap((worker) =>
        !channelIds.has(worker.channelId) || isChannelLead(worker)
          ? []
          : [channelMemberFromWorker(worker)],
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
          ...channelColumns({ ...input, checklist: [] }),
          updated_at: lead.createdAt,
        })}
      `;
      await new WorkerDatabase(db).create(lead);
      return requireChannel(db, id);
    });
  }

  async getChannel(channelId: string): Promise<Channel | null> {
    return (await readChannels(this.db, channelId))[0] ?? null;
  }

  async editChannel({ channelId, ...changes }: EditChannelInput) {
    return inStateTransaction(this.db, async (db) => {
      const channel = await requireChannel(db, channelId);
      return updateChannelFields(db, channel, changes, { type: "user" });
    });
  }

  async deleteChannel(channelId: string): Promise<boolean> {
    return inStateTransaction(this.db, async (db) => {
      const workerDatabase = new WorkerDatabase(db);
      const workers = await workerDatabase.list({ type: "channel", channelId });
      for (const worker of workers) await workerDatabase.delete(worker.sessionId);
      const rows = await db<{ id: string }[]>`
        DELETE FROM channels WHERE id = ${channelId} RETURNING id
      `;
      return rows.length > 0;
    });
  }

  async markUserSeen(channelId: string, sequence: number): Promise<Channel | null> {
    return inStateTransaction(this.db, async (db) => {
      const [row] = await db<{ id: string }[]>`
        UPDATE channels
        SET seen_through = MIN(latest_sequence, MAX(seen_through, ${sequence}))
        WHERE id = ${channelId} AND seen_through < MIN(latest_sequence, ${sequence})
        RETURNING id
      `;
      return row ? requireChannel(db, channelId) : null;
    });
  }

  async getRevision(channelId: string): Promise<number | null> {
    const [row] = await this.db<Pick<ChannelRow, "revision">[]>`
      SELECT revision FROM channels WHERE id = ${channelId}
    `;
    return row?.revision ?? null;
  }

  async getState(channelId: string, messageLimit: number): Promise<ChannelState | null> {
    return inStateTransaction(this.db, async (db) => {
      const [row] = await db<ChannelRow[]>`SELECT * FROM channels WHERE id = ${channelId}`;
      if (!row) return null;
      const workers = await new WorkerDatabase(db).list({ type: "channel", channelId });
      return {
        revision: row.revision,
        ...channelRoster(workers),
        messages: await listMessagesBefore(db, channelId, undefined, messageLimit),
        artifacts: await listArtifacts(db, channelId),
      };
    });
  }

  async getRoster(channelId: string) {
    return channelRoster(await new WorkerDatabase(this.db).list({ type: "channel", channelId }));
  }

  async listMembers(channelId: string): Promise<ChannelMember[]> {
    return listMembers(this.db, channelId);
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
      await requireChannel(db, worker.channelId);
      await assertMemberNameAvailable(db, worker.channelId, worker.name);
      await new WorkerDatabase(db).create(worker);
      const member = channelMemberFromWorker(worker);
      const change = await appendSystemMessage(db, worker.channelId, {
        type: "member_joined",
        member,
      });
      return { ...change, member, channel: await requireChannel(db, worker.channelId) };
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
        return { changed: false as const, member };
      }
      if (name !== worker.name) {
        await assertMemberNameAvailable(db, worker.channelId, name, worker.sessionId);
      }
      await new WorkerDatabase(db).update(worker.sessionId, { name, metadata });
      return {
        changed: true as const,
        member,
        revision: await advanceRevision(db, worker.channelId),
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

  async clearWaitingAgentStatus(agentId: string) {
    return changeAgentStatus(this.db, agentId, undefined, false, "waiting");
  }

  async updateChannel(leadId: string, input: UpdateChannelInput) {
    return inStateTransaction(this.db, async (db) => {
      const channel = await requireLeadChannel(db, leadId);
      if (input.checklist) {
        const agentIds = new Set(
          (await new WorkerDatabase(db).list({ type: "channel", channelId: channel.id })).map(
            ({ sessionId }) => sessionId,
          ),
        );
        assertChecklistOwners(input.checklist, agentIds);
      }
      return updateChannelFields(db, channel, input, { type: "agent", agentId: leadId });
    });
  }

  async markDone(leadId: string) {
    return inStateTransaction(this.db, async (db) => {
      const channel = await requireLeadChannel(db, leadId);
      const blockers = channelCompletionBlockers(
        channel.checklist,
        await listMembers(db, channel.id),
      );
      if (blockers.length) {
        throw new Error(
          `Cannot mark channel done:\n${blockers.map((item) => `- ${item}`).join("\n")}`,
        );
      }
      const change = await appendSystemMessage(db, channel.id, {
        type: "channel_marked_done",
      });
      return { ...change, channel: await requireChannel(db, channel.id) };
    });
  }

  async requestUserAttention(leadId: string, requestSequence: number) {
    return inStateTransaction(this.db, async (db) => {
      const channel = await requireLeadChannel(db, leadId);
      const [request] = await db<{ id: string }[]>`
        SELECT id FROM channel_messages
        WHERE channel_id = ${channel.id} AND sequence = ${requestSequence}
          AND sender_type = 'agent'
      `;
      if (!request) throw new Error("Reference an agent message in this channel.");
      const [existing] = await db<ChannelMessageRow[]>`
        SELECT * FROM channel_messages
        WHERE channel_id = ${channel.id} AND sender_type = 'system'
          AND json_extract(content, '$.type') = 'user_attention_requested'
          AND json_extract(content, '$.requestSequence') = ${requestSequence}
        ORDER BY sequence DESC LIMIT 1
      `;
      if (existing) {
        return { changed: false as const, channel, message: messageFromRow(existing, []) };
      }
      const change = await appendSystemMessage(db, channel.id, {
        type: "user_attention_requested",
        requestSequence,
      });
      return { changed: true as const, ...change, channel: await requireChannel(db, channel.id) };
    });
  }

  async deleteMember(agentId: string) {
    return inStateTransaction(this.db, async (db) => {
      const workers = new WorkerDatabase(db);
      const worker = await workers.get(agentId, "channel");
      if (!worker || isChannelLead(worker)) return null;
      const member = channelMemberFromWorker(worker);
      if (!(await workers.delete(agentId))) return null;
      const [channel] = await db<Pick<ChannelRow, "checklist">[]>`
        SELECT checklist FROM channels WHERE id = ${member.channelId}
      `;
      if (!channel) throw new Error("Channel not found.");
      const checklist = unassignChannelChecklist(
        channelChecklistItemSchema.array().parse(JSON.parse(channel.checklist)),
        agentId,
      );
      const serializedChecklist = JSON.stringify(checklist);
      if (serializedChecklist !== channel.checklist) {
        await db`
          UPDATE channels SET checklist = ${serializedChecklist} WHERE id = ${member.channelId}
        `;
      }
      const change = await appendSystemMessage(db, member.channelId, {
        type: "member_left",
        member,
      });
      return {
        ...change,
        member,
        channel: await requireChannel(db, member.channelId),
      };
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

  async appendMessage({
    channelId,
    attachments,
    ...message
  }: Omit<ChannelConversationMessage, "sequence" | "timestamp" | "reactions"> & {
    channelId: string;
  }) {
    return inStateTransaction(this.db, async (db) => {
      const acknowledgedRequest =
        message.sender.type === "user" && (await requireChannel(db, channelId)).hasPendingRequest;
      const change = await appendMessage(db, channelId, (position) => ({
        ...message,
        ...position,
        ...(attachments?.length ? { attachments } : {}),
      }));
      return { ...change, acknowledgedRequest, channel: await requireChannel(db, channelId) };
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
      return { reaction, revision: await advanceRevision(db, input.channelId) };
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
      if (!row) return { artifact: { file: input.file, title: input.title } };
      const artifact = artifactFromRow(row);
      const change = await appendSystemMessage(db, input.channelId, {
        type: "artifact_shared",
        actor: input.actor,
        artifact: { file: artifact.file, title: artifact.title },
      });
      return {
        ...change,
        artifact,
        channel: await requireChannel(db, input.channelId),
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
  if (Bun.deepEquals(next, current)) {
    return { changed: false as const, channel: current, messages: [] };
  }
  const updates: ChannelSystemMessageContent[] = [];
  if (next.name !== current.name) updates.push({ type: "channel_renamed", actor, name: next.name });
  if (next.purpose !== current.purpose)
    updates.push({ type: "channel_purpose_changed", actor, purpose: next.purpose ?? null });
  if (next.directory !== current.directory)
    updates.push({ type: "channel_directory_changed", actor, directory: next.directory ?? null });
  // User edits count as activity; lead checklist and preview changes stay quiet.
  await db`
    UPDATE channels SET ${db({
      ...channelColumns(next),
      updated_at: actor.type === "user" ? new Date().toISOString() : current.updatedAt,
    })}
    WHERE id = ${current.id}
  `;
  const messages: { revision: number; message: ChannelSystemMessage }[] = [];
  for (const content of updates) {
    messages.push(await appendSystemMessage(db, current.id, content));
  }
  return { changed: true as const, channel: await requireChannel(db, current.id), messages };
}

function channelColumns(
  channel: Pick<Channel, "name" | "purpose" | "directory" | "model" | "checklist" | "previewUrl">,
) {
  return {
    name: channel.name,
    purpose: channel.purpose ?? null,
    directory: channel.directory ?? null,
    model: JSON.stringify(channel.model),
    checklist: JSON.stringify(channel.checklist),
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
      agentId,
      channelId: worker.channelId,
      status,
      revision: await advanceRevision(transaction, worker.channelId),
    };
  });
}

async function getAgent(db: Bun.SQL, agentId: string) {
  const worker = await new WorkerDatabase(db).get(agentId, "channel");
  if (!worker) return null;
  return channelAgentFromWorker(worker);
}

async function listMembers(db: Bun.SQL, channelId: string): Promise<ChannelMember[]> {
  return channelMembersFromWorkers(
    await new WorkerDatabase(db).list({ type: "channel", channelId }),
  );
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

type ChannelRow = {
  id: string;
  name: string;
  purpose: string | null;
  directory: string | null;
  model: string;
  checklist: string;
  preview_url: string | null;
  latest_sequence: number;
  revision: number;
  seen_through: number;
  updated_at: string;
};

type ChannelMessageRow = {
  id: string;
  channel_id: string;
  sequence: number;
  sender_type: ChannelMessageSender["type"];
  sender_agent_id: string | null;
  content: string;
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

async function readChannels(db: Bun.SQL, channelId?: string): Promise<Channel[]> {
  const where = channelId === undefined ? db`` : db`WHERE channel.id = ${channelId}`;
  const rows = await db<
    (ChannelRow & { has_unread_completion: number; has_pending_request: number })[]
  >`
    SELECT channel.*,
      EXISTS (
        SELECT 1 FROM channel_messages AS message
        WHERE message.channel_id = channel.id AND message.sender_type = 'system'
          AND message.sequence > channel.seen_through
          AND json_extract(message.content, '$.type') = 'channel_marked_done'
      ) AS has_unread_completion,
      EXISTS (
        SELECT 1 FROM channel_messages AS message
        WHERE message.channel_id = channel.id AND message.sender_type = 'system'
          AND json_extract(message.content, '$.type') = 'user_attention_requested'
          AND json_extract(message.content, '$.requestSequence') > COALESCE((
            SELECT MAX(response.sequence) FROM channel_messages AS response
            WHERE response.channel_id = channel.id AND response.sender_type = 'user'
          ), 0)
      ) AS has_pending_request
    FROM channels AS channel
    ${where}
    ORDER BY channel.updated_at DESC, channel.id
  `;
  return rows.map(channelFromRow);
}

function channelFromRow(
  row: ChannelRow & { has_unread_completion: number; has_pending_request: number },
): Channel {
  return {
    id: row.id,
    name: row.name,
    ...(row.purpose ? { purpose: row.purpose } : {}),
    ...(row.directory ? { directory: row.directory } : {}),
    model: modelConfigurationSchema.parse(JSON.parse(row.model)),
    checklist: channelChecklistItemSchema.array().parse(JSON.parse(row.checklist)),
    ...(row.preview_url ? { previewUrl: row.preview_url } : {}),
    latestSequence: row.latest_sequence,
    seenThrough: row.seen_through,
    hasUnreadCompletion: Boolean(row.has_unread_completion),
    hasPendingRequest: Boolean(row.has_pending_request),
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
  const [channel] = await readChannels(db, channelId);
  if (!channel) throw new Error("Channel not found.");
  return channel;
}

async function requireLeadChannel(db: Bun.SQL, leadId: string): Promise<Channel> {
  const [channel] = await readChannels(db, leadId);
  if (!channel) throw new Error("Only the channel lead can update the channel.");
  return channel;
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

function assertChecklistOwners(
  checklist: readonly ChannelChecklistItem[],
  agentIds: ReadonlySet<string>,
): void {
  for (const item of checklist) {
    if (item.ownerId && !agentIds.has(item.ownerId)) {
      throw new Error("Checklist owners must be the channel lead or a current member.");
    }
    if (item.children) assertChecklistOwners(item.children, agentIds);
  }
}
