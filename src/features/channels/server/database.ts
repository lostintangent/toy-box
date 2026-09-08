import { AgentDatabase } from "@agents/server/database";
import {
  channelReactionSchema,
  type Channel,
  type ChannelArtifact,
  type ChannelMember,
  type ChannelMessage,
  type ChannelReaction,
  type ChannelMessageSender,
  type ChannelSnapshot,
  type CreateChannelInput,
  type RenameChannelInput,
} from "@channels/model";
import { machineFile, sessionFile } from "@files/model";
import { messageAttachmentsSchema, type Attachment } from "@sessions/model/protocol";
import { inStateTransaction } from "@/server/database";

const CHANNEL_ID_PREFIX = "toy-box-channel-";

/** Durable Channels, ordered messages, member cursors, and shared file references. */
export class ChannelDatabase {
  constructor(private readonly db: Bun.SQL) {}

  async listChannels(): Promise<Channel[]> {
    const rows = await this.db<ChannelRow[]>`
      SELECT * FROM channels ORDER BY updated_at DESC, id
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
        id, title, directory, latest_sequence, event_cursor, seen_through, updated_at
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

  async getSnapshot(channelId: string): Promise<ChannelSnapshot | null> {
    return inStateTransaction(this.db, async (db) => {
      const [row] = await db<Pick<ChannelRow, "event_cursor">[]>`
        SELECT event_cursor FROM channels WHERE id = ${channelId}
      `;
      if (!row) return null;
      return {
        cursor: row.event_cursor,
        members: await listMembers(db, channelId),
        messages: await listMessages(db, channelId),
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
      const [channel] = await db<Pick<ChannelRow, "event_cursor">[]>`
        UPDATE channels SET event_cursor = event_cursor + 1
        WHERE id = ${input.channelId}
        RETURNING event_cursor
      `;
      if (!channel) throw new Error("Channel not found.");
      return { member, cursor: channel.event_cursor };
    });
  }

  async markMemberSeen(member: ChannelMember, sequence: number): Promise<void> {
    await this.db`
      UPDATE channel_members
      SET seen_through = MIN(
        (SELECT latest_sequence FROM channels WHERE id = ${member.host.channelId}),
        MAX(seen_through, ${sequence})
      )
      WHERE session_id = ${member.sessionId}
        AND seen_through < MIN(
          (SELECT latest_sequence FROM channels WHERE id = ${member.host.channelId}),
          ${sequence}
        )
    `;
  }

  async deleteMemberBySession(sessionId: string) {
    return inStateTransaction(this.db, async (db) => {
      const member = await getMemberBySession(db, sessionId);
      if (!member) return null;
      if (!(await new AgentDatabase(db).deleteMembershipBySession(sessionId))) return null;
      const [channel] = await db<Pick<ChannelRow, "event_cursor">[]>`
        UPDATE channels SET event_cursor = event_cursor + 1
        WHERE id = ${member.host.channelId}
        RETURNING event_cursor
      `;
      if (!channel) throw new Error("Channel not found.");
      return { member, cursor: channel.event_cursor };
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

  async listMessages(
    channelId: string,
    afterSequence = 0,
    limit?: number,
  ): Promise<ChannelMessage[]> {
    return listMessages(this.db, channelId, afterSequence, limit);
  }

  async appendMessage(input: {
    id: string;
    channelId: string;
    sender: ChannelMessageSender;
    content: string;
    attachments?: Attachment[];
  }) {
    return inStateTransaction(this.db, async (db) => {
      const now = new Date().toISOString();
      const [channel] = await db<ChannelRow[]>`
        UPDATE channels
        SET
          latest_sequence = latest_sequence + 1,
          event_cursor = event_cursor + 1,
          updated_at = ${now}
        WHERE id = ${input.channelId}
        RETURNING *
      `;
      if (!channel) throw new Error("Channel not found.");
      const message: ChannelMessage = {
        id: input.id,
        sequence: channel.latest_sequence,
        sender: input.sender,
        content: input.content,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        reactions: [],
        timestamp: now,
      };
      await db`
        INSERT INTO channel_messages (
          id, channel_id, sequence, sender_type, sender_agent_id, content, attachments, timestamp
        ) VALUES (
          ${message.id}, ${input.channelId}, ${message.sequence}, ${message.sender.type},
          ${message.sender.type === "agent" ? message.sender.agentId : null},
          ${message.content}, ${JSON.stringify(message.attachments ?? [])}, ${message.timestamp}
        )
      `;
      return {
        channel: channelFromRow(channel),
        message,
        cursor: channel.event_cursor,
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
        const [row] = await db<ChannelReactionRow[]>`
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
          RETURNING *
        `;
        if (!row) throw new Error("React to a user or Agent message in this Channel.");
        reaction = reactionFromRow(row);
      }
      const [channel] = await db<Pick<ChannelRow, "event_cursor">[]>`
        UPDATE channels SET event_cursor = event_cursor + 1
        WHERE id = ${input.channelId}
        RETURNING event_cursor
      `;
      if (!channel) throw new Error("Channel not found.");
      return { reaction, cursor: channel.event_cursor };
    });
  }

  async listArtifacts(channelId: string): Promise<ChannelArtifact[]> {
    return listArtifacts(this.db, channelId);
  }

  async upsertArtifact(input: { channelId: string; file: ChannelArtifact["file"]; title: string }) {
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
      const [channel] = await db<ChannelRow[]>`
        UPDATE channels SET
          updated_at = ${new Date().toISOString()},
          event_cursor = event_cursor + 1
        WHERE id = ${input.channelId}
        RETURNING *
      `;
      if (!channel) throw new Error("Channel not found.");
      return {
        artifact: artifactFromRow(row),
        channel: channelFromRow(channel),
        cursor: channel.event_cursor,
      };
    });
  }
}

async function getMemberBySession(db: Bun.SQL, sessionId: string): Promise<ChannelMember | null> {
  const [row] = await db<ChannelMemberRow[]>`
    SELECT
      membership.host_id AS channel_id, member.seen_through,
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
      membership.host_id AS channel_id, member.seen_through,
      membership.agent_id, membership.session_id, membership.execution_mode
    FROM channel_members AS member
    JOIN agent_memberships AS membership ON membership.session_id = member.session_id
    WHERE membership.host_kind = 'channel' AND membership.host_id = ${channelId}
    ORDER BY membership.session_id
  `;
  return rows.map(memberFromRow);
}

async function listMessages(
  db: Bun.SQL,
  channelId: string,
  afterSequence = 0,
  limit?: number,
): Promise<ChannelMessage[]> {
  const rows = await db<ChannelMessageRow[]>`
    SELECT * FROM channel_messages
    WHERE channel_id = ${channelId} AND sequence > ${afterSequence}
    ORDER BY sequence
    LIMIT ${limit ?? -1}
  `;
  const lastSequence = rows.at(-1)?.sequence;
  if (lastSequence === undefined) return [];
  const reactionRows = await db<ChannelReactionRow[]>`
    SELECT * FROM channel_message_reactions
    WHERE channel_id = ${channelId}
      AND message_sequence > ${afterSequence}
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
  event_cursor: number;
  seen_through: number;
  updated_at: string;
};

type ChannelMemberRow = {
  channel_id: string;
  agent_id: string;
  session_id: string;
  execution_mode: ChannelMember["executionMode"];
  seen_through: number;
};

type ChannelMessageRow = {
  id: string;
  channel_id: string;
  sequence: number;
  sender_type: ChannelMessageSender["type"];
  sender_agent_id: string | null;
  content: string;
  attachments: string;
  timestamp: string;
};

type ChannelReactionRow = {
  channel_id: string;
  message_sequence: number;
  agent_id: string;
  reaction: string;
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
  };
}

function artifactFromRow(row: ChannelArtifactRow): ChannelArtifact {
  return {
    file: row.kind === "session" ? sessionFile(row.session_id, row.path) : machineFile(row.path),
    title: row.title,
  };
}

function messageFromRow(row: ChannelMessageRow, reactions: ChannelReaction[]): ChannelMessage {
  const attachments = messageAttachmentsSchema.parse(JSON.parse(row.attachments));
  let sender: ChannelMessageSender;
  if (row.sender_type === "user") {
    sender = { type: "user" };
  } else if (row.sender_type === "system") {
    sender = { type: "system" };
  } else {
    if (!row.sender_agent_id) {
      throw new Error(
        `Channel agent message ${row.channel_id}:${row.sequence} is missing sender attribution.`,
      );
    }
    sender = {
      type: "agent",
      agentId: row.sender_agent_id,
    };
  }
  return {
    id: row.id,
    sequence: row.sequence,
    sender,
    content: row.content,
    ...(attachments.length ? { attachments } : {}),
    reactions,
    timestamp: row.timestamp,
  };
}

function reactionFromRow(row: ChannelReactionRow): ChannelReaction {
  return channelReactionSchema.parse({
    agentId: row.agent_id,
    reaction: row.reaction,
  });
}

function reactionsByMessage(rows: ChannelReactionRow[]): Map<number, ChannelReaction[]> {
  const reactions = new Map<number, ChannelReaction[]>();
  for (const row of rows) {
    const messageReactions = reactions.get(row.message_sequence) ?? [];
    messageReactions.push(reactionFromRow(row));
    reactions.set(row.message_sequence, messageReactions);
  }
  return reactions;
}
