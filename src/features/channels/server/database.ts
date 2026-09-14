import type { AgentMembership } from "@agents/model";
import { AgentDatabase } from "@agents/server/database";
import {
  channelAttachmentSchema,
  channelMemberStatusSchema,
  channelSystemMessageContentSchema,
  type Channel,
  type ChannelAttachment,
  type ChannelArtifact,
  type ChannelList,
  type ChannelMember,
  type ChannelMemberStatus,
  type ChannelMessage,
  type ChannelReaction,
  type ChannelMessageSender,
  type ChannelState,
  type ChannelSystemMessageContent,
  type CreateChannelInput,
  type RenameChannelInput,
} from "@channels/model";
import { machineFile, sessionFile } from "@files/model";
import { inStateTransaction } from "@/server/database";

const CHANNEL_ID_PREFIX = "toy-box-channel-";

type AppendConversationMessageInput = {
  id: string;
  channelId: string;
  sender: Exclude<ChannelMessageSender, { type: "system" }>;
  content: string;
  attachments?: ChannelAttachment[];
};

type AppendSystemMessageInput = {
  id: string;
  channelId: string;
  sender: { type: "system" };
  content: ChannelSystemMessageContent;
};

type AppendMessageInput = AppendConversationMessageInput | AppendSystemMessageInput;

/** Durable Channels, ordered messages, member read positions, and shared file references. */
export class ChannelDatabase {
  constructor(private readonly db: Bun.SQL) {}

  async listChannels(): Promise<ChannelList> {
    const [channels, memberships] = await Promise.all([
      this.db<ChannelRow[]>`SELECT * FROM channels ORDER BY updated_at DESC, id`,
      this.db<ChannelMembershipRow[]>`
        SELECT
          membership.host_id AS channel_id, membership.agent_id,
          membership.session_id, membership.execution_mode
        FROM agent_memberships AS membership
        JOIN channels AS channel ON channel.id = membership.host_id
        WHERE membership.host_kind = 'channel'
        ORDER BY membership.host_id, membership.session_id
      `,
    ]);
    return {
      channels: channels.map(channelFromRow),
      memberships: memberships.map(membershipFromRow),
    };
  }

  async listAgentChannels(agentId: string): Promise<Channel[]> {
    const rows = await this.db<ChannelRow[]>`
      SELECT channel.*
      FROM channels AS channel
      JOIN agent_memberships AS membership
        ON membership.host_kind = 'channel' AND membership.host_id = channel.id
      WHERE membership.agent_id = ${agentId}
      ORDER BY channel.updated_at DESC, channel.id
    `;
    return rows.map(channelFromRow);
  }

  async createChannel(input: CreateChannelInput): Promise<Channel> {
    const channel: Channel = {
      id: `${CHANNEL_ID_PREFIX}${crypto.randomUUID()}`,
      title: input.title,
      ...(input.directory ? { directory: input.directory } : {}),
      latestSequence: 0,
      seenThrough: 0,
      updatedAt: new Date().toISOString(),
    };
    await this.db`
      INSERT INTO channels (
        id, title, directory, latest_sequence, revision, seen_through, updated_at
      )
      VALUES (
        ${channel.id}, ${channel.title}, ${channel.directory ?? null},
        ${channel.latestSequence}, 0, ${channel.seenThrough}, ${channel.updatedAt}
      )
    `;
    return channel;
  }

  async getChannel(channelId: string): Promise<Channel | null> {
    const [row] = await this.db<ChannelRow[]>`SELECT * FROM channels WHERE id = ${channelId}`;
    return row ? channelFromRow(row) : null;
  }

  async renameChannel(input: RenameChannelInput): Promise<Channel | null> {
    const [row] = await this.db<ChannelRow[]>`
      UPDATE channels
      SET title = ${input.title}, updated_at = ${new Date().toISOString()}
      WHERE id = ${input.channelId}
      RETURNING *
    `;
    return row ? channelFromRow(row) : null;
  }

  async deleteChannel(channelId: string): Promise<boolean> {
    const rows = await this.db<{ id: string }[]>`
      DELETE FROM channels WHERE id = ${channelId} RETURNING id
    `;
    return rows.length > 0;
  }

  async markUserSeen(channelId: string, sequence: number): Promise<Channel | null> {
    const [row] = await this.db<ChannelRow[]>`
      UPDATE channels
      SET seen_through = MIN(latest_sequence, MAX(seen_through, ${sequence}))
      WHERE id = ${channelId} AND seen_through < MIN(latest_sequence, ${sequence})
      RETURNING *
    `;
    return row ? channelFromRow(row) : null;
  }

  async getRevision(channelId: string): Promise<number | null> {
    const [row] = await this.db<Pick<ChannelRow, "revision">[]>`
      SELECT revision FROM channels WHERE id = ${channelId}
    `;
    return row?.revision ?? null;
  }

  async getState(channelId: string, messageLimit: number): Promise<ChannelState | null> {
    return inStateTransaction(this.db, async (db) => {
      const [row] = await db<Pick<ChannelRow, "revision">[]>`
        SELECT revision FROM channels WHERE id = ${channelId}
      `;
      if (!row) return null;
      return {
        revision: row.revision,
        members: await listMembers(db, channelId),
        messages: await listMessagesBefore(db, channelId, undefined, messageLimit),
        artifacts: await listArtifacts(db, channelId),
      };
    });
  }

  async listMembers(channelId: string): Promise<ChannelMember[]> {
    return listMembers(this.db, channelId);
  }

  async getMemberBySession(sessionId: string): Promise<ChannelMember | null> {
    return getMemberBySession(this.db, sessionId);
  }

  async getMember(channelId: string, agentId: string): Promise<ChannelMember | null> {
    const [row] = await this.db<ChannelMemberRow[]>`
      SELECT
        membership.host_id AS channel_id, member.seen_through, member.status,
        membership.agent_id, membership.session_id, membership.execution_mode
      FROM channel_members AS member
      JOIN agent_memberships AS membership ON membership.session_id = member.session_id
      WHERE membership.host_kind = 'channel'
        AND membership.host_id = ${channelId}
        AND membership.agent_id = ${agentId}
    `;
    return row ? memberFromRow(row) : null;
  }

  async createMember(input: {
    channelId: string;
    agentId: string;
    sessionId: string;
    executionMode: ChannelMember["executionMode"];
  }) {
    return inStateTransaction(this.db, async (db) => {
      const membership = await new AgentDatabase(db).createMembership({
        host: { kind: "channel", channelId: input.channelId },
        agentId: input.agentId,
        sessionId: input.sessionId,
        executionMode: input.executionMode,
      });
      const rows = await db<{ session_id: string }[]>`
        INSERT INTO channel_members (session_id, seen_through)
        SELECT ${membership.sessionId}, 0 FROM channels WHERE id = ${input.channelId}
        RETURNING session_id
      `;
      if (rows.length === 0) throw new Error("Channel not found.");
      const member: ChannelMember = {
        ...membership,
        host: { kind: "channel", channelId: input.channelId },
        seenThrough: 0,
      };
      const change = await appendMessage(db, {
        id: crypto.randomUUID(),
        channelId: input.channelId,
        sender: { type: "system" },
        content: { type: "member_joined", member },
      });
      return { ...change, member };
    });
  }

  async markMemberSeen(member: ChannelMember, sequence: number): Promise<void> {
    await this.db`
      UPDATE channel_members
      SET seen_through = ${sequence}
      WHERE session_id = ${member.sessionId} AND seen_through < ${sequence}
    `;
  }

  async setMemberStatus(member: ChannelMember, status?: ChannelMemberStatus) {
    return changeMemberStatus(this.db, member, status);
  }

  async clearWaitingMemberStatus(member: ChannelMember) {
    return changeMemberStatus(this.db, member, undefined, "waiting");
  }

  async deleteMemberBySession(sessionId: string) {
    return inStateTransaction(this.db, async (db) => {
      const member = await getMemberBySession(db, sessionId);
      if (!member) return null;
      if (!(await new AgentDatabase(db).deleteMembershipBySession(sessionId))) return null;
      const change = await appendMessage(db, {
        id: crypto.randomUUID(),
        channelId: member.host.channelId,
        sender: { type: "system" },
        content: { type: "member_left", member },
      });
      return { ...change, member };
    });
  }

  async listMemberSessionIds(channelId: string): Promise<string[]> {
    const rows = await this.db<{ session_id: string }[]>`
      SELECT session_id FROM agent_memberships
      WHERE host_kind = 'channel' AND host_id = ${channelId}
      ORDER BY session_id
    `;
    return rows.map((row) => row.session_id);
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

  async appendMessage(input: AppendMessageInput) {
    return inStateTransaction(this.db, (db) => appendMessage(db, input));
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
      const [channel] = await db<Pick<ChannelRow, "revision">[]>`
        UPDATE channels SET revision = revision + 1
        WHERE id = ${input.channelId}
        RETURNING revision
      `;
      if (!channel) throw new Error("Channel not found.");
      return { reaction, revision: channel.revision };
    });
  }

  async listArtifacts(channelId: string): Promise<ChannelArtifact[]> {
    return listArtifacts(this.db, channelId);
  }

  async shareArtifact(input: {
    id: string;
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
        ON CONFLICT
        DO UPDATE SET title = excluded.title
        RETURNING kind, session_id, path, title
      `;
      if (!row) throw new Error("Channel not found.");
      const artifact = artifactFromRow(row);
      const change = await appendMessage(db, {
        id: input.id,
        channelId: input.channelId,
        sender: { type: "system" },
        content: { type: "artifact_shared", actor: input.actor, artifact },
      });
      return {
        ...change,
        artifact,
      };
    });
  }
}

async function appendMessage(db: Bun.SQL, input: AppendMessageInput) {
  const now = new Date().toISOString();
  const [channel] = await db<ChannelRow[]>`
    UPDATE channels
    SET
      latest_sequence = latest_sequence + 1,
      revision = revision + 1,
      updated_at = ${now}
    WHERE id = ${input.channelId}
    RETURNING *
  `;
  if (!channel) throw new Error("Channel not found.");
  const common = {
    id: input.id,
    sequence: channel.latest_sequence,
    timestamp: now,
  };
  const isSystemMessage = isAppendSystemMessage(input);
  const message: ChannelMessage = isSystemMessage
    ? { ...common, sender: input.sender, content: input.content }
    : {
        ...common,
        sender: input.sender,
        content: input.content,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      };
  const encodedContent = isSystemMessage ? JSON.stringify(input.content) : input.content;
  const attachments = isSystemMessage ? undefined : input.attachments;
  await db`
    INSERT INTO channel_messages (
      id, channel_id, sequence, sender_type, sender_agent_id, content, attachments, timestamp
    ) VALUES (
      ${message.id}, ${input.channelId}, ${message.sequence}, ${message.sender.type},
      ${message.sender.type === "agent" ? message.sender.agentId : null},
      ${encodedContent}, ${attachments?.length ? JSON.stringify(attachments) : null},
      ${message.timestamp}
    )
  `;
  return {
    channel: channelFromRow(channel),
    message,
    revision: channel.revision,
  };
}

async function changeMemberStatus(
  db: Bun.SQL,
  member: ChannelMember,
  status: ChannelMemberStatus | undefined,
  requiredState?: ChannelMemberStatus["state"],
) {
  return inStateTransaction(db, async (transaction) => {
    const encodedStatus = status ? JSON.stringify(status) : null;
    const rows = await transaction<{ session_id: string }[]>`
      UPDATE channel_members
      SET status = ${encodedStatus}
      WHERE session_id = ${member.sessionId}
        AND status IS NOT ${encodedStatus}
        AND (${requiredState ?? null} IS NULL OR json_extract(status, '$.state') = ${requiredState ?? null})
      RETURNING session_id
    `;
    if (rows.length === 0) return null;
    const [channel] = await transaction<Pick<ChannelRow, "revision">[]>`
      UPDATE channels SET revision = revision + 1
      WHERE id = ${member.host.channelId}
      RETURNING revision
    `;
    if (!channel) throw new Error("Channel membership is incomplete.");
    return { status, revision: channel.revision };
  });
}

async function getMemberBySession(db: Bun.SQL, sessionId: string): Promise<ChannelMember | null> {
  const [row] = await db<ChannelMemberRow[]>`
    SELECT
      membership.host_id AS channel_id, member.seen_through, member.status,
      membership.agent_id, membership.session_id, membership.execution_mode
    FROM channel_members AS member
    JOIN agent_memberships AS membership ON membership.session_id = member.session_id
    WHERE membership.session_id = ${sessionId} AND membership.host_kind = 'channel'
  `;
  return row ? memberFromRow(row) : null;
}

async function listMembers(db: Bun.SQL, channelId: string): Promise<ChannelMember[]> {
  const rows = await db<ChannelMemberRow[]>`
    SELECT
      membership.host_id AS channel_id, member.seen_through, member.status,
      membership.agent_id, membership.session_id, membership.execution_mode
    FROM channel_members AS member
    JOIN agent_memberships AS membership ON membership.session_id = member.session_id
    WHERE membership.host_kind = 'channel' AND membership.host_id = ${channelId}
    ORDER BY membership.session_id
  `;
  return rows.map(memberFromRow);
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
    SELECT kind, session_id, path, title FROM channel_artifacts
    WHERE channel_id = ${channelId}
    ORDER BY created_at, kind, session_id, path
  `;
  return rows.map(artifactFromRow);
}

type ChannelRow = {
  id: string;
  title: string;
  directory: string | null;
  latest_sequence: number;
  revision: number;
  seen_through: number;
  updated_at: string;
};

type ChannelMemberRow = {
  channel_id: string;
  agent_id: string;
  session_id: string;
  execution_mode: ChannelMember["executionMode"];
  seen_through: number;
  status: string | null;
};

type ChannelMembershipRow = Omit<ChannelMemberRow, "seen_through" | "status">;

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

type ChannelArtifactRow =
  | { kind: "session"; session_id: string; path: string; title: string }
  | { kind: "machine"; session_id: null; path: string; title: string };

function channelFromRow(row: ChannelRow): Channel {
  return {
    id: row.id,
    title: row.title,
    ...(row.directory ? { directory: row.directory } : {}),
    latestSequence: row.latest_sequence,
    seenThrough: row.seen_through,
    updatedAt: row.updated_at,
  };
}

function memberFromRow(row: ChannelMemberRow): ChannelMember {
  return {
    host: { kind: "channel", channelId: row.channel_id },
    agentId: row.agent_id,
    sessionId: row.session_id,
    executionMode: row.execution_mode,
    seenThrough: row.seen_through,
    ...(row.status ? { status: channelMemberStatusSchema.parse(JSON.parse(row.status)) } : {}),
  };
}

function membershipFromRow(row: ChannelMembershipRow): AgentMembership {
  return {
    host: { kind: "channel", channelId: row.channel_id },
    agentId: row.agent_id,
    sessionId: row.session_id,
    executionMode: row.execution_mode,
  };
}

function artifactFromRow(row: ChannelArtifactRow): ChannelArtifact {
  return {
    file: row.kind === "session" ? sessionFile(row.session_id, row.path) : machineFile(row.path),
    title: row.title,
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

function isAppendSystemMessage(input: AppendMessageInput): input is AppendSystemMessageInput {
  return input.sender.type === "system";
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
