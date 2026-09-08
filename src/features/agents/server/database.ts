import {
  agentHandleFromName,
  agentHostId,
  fileAgentHostSchema,
  type Agent,
  type AgentAvatar,
  type AgentExperience,
  type AgentMembership,
  type AgentHost,
  type CreateAgentInput,
  type ManageAgentExperienceInput,
  type SelfUpdateAgentInput,
  type UpdateAgentInput,
} from "@agents/model";
import { parseSerializedModelConfiguration } from "@sessions/model/modelConfiguration";
import { inStateTransaction } from "@/server/database";

const AGENT_ID_PREFIX = "toy-box-agent-";
const EXPERIENCE_ID_PREFIX = "toy-box-experience-";

/** Durable Agent identities, experiences, and host memberships. */
export class AgentDatabase {
  constructor(private readonly db: Bun.SQL) {}

  async listAgents(): Promise<Agent[]> {
    const [agents, experiences] = await Promise.all([
      this.db<AgentRow[]>`SELECT * FROM agents ORDER BY name COLLATE NOCASE, id`,
      this.db<AgentExperienceRow[]>`
        SELECT * FROM agent_experiences ORDER BY created_at DESC, id
      `,
    ]);
    const experiencesByAgent = groupExperiences(experiences);
    return agents.map((row) => agentFromRow(row, experiencesByAgent.get(row.id) ?? []));
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    const [row] = await this.db<AgentRow[]>`SELECT * FROM agents WHERE id = ${agentId}`;
    return row ? agentFromRow(row, await this.listExperiences(agentId)) : null;
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    return inStateTransaction(this.db, async (db) => {
      await assertAgentNameAvailable(db, input.name);
      const agent: Agent = {
        id: `${AGENT_ID_PREFIX}${crypto.randomUUID()}`,
        name: input.name,
        ...(input.persona ? { persona: input.persona } : {}),
        experiences: [],
      };
      await db`INSERT INTO agents (id, name, persona) VALUES (${agent.id}, ${agent.name}, ${input.persona ?? null})`;
      return agent;
    });
  }

  async updateAgent(input: UpdateAgentInput): Promise<Agent | null> {
    const writesModel = input.model !== undefined;
    const row = await inStateTransaction(this.db, async (db) => {
      if (input.name !== undefined) {
        await assertAgentNameAvailable(db, input.name, input.agentId);
      }
      const [updated] = await db<AgentRow[]>`
        UPDATE agents
        SET
          name = COALESCE(${input.name ?? null}, name),
          persona = COALESCE(${input.persona ?? null}, persona),
          model_configuration = CASE
            WHEN ${writesModel} THEN ${input.model ? JSON.stringify(input.model) : null}
            ELSE model_configuration
          END
        WHERE id = ${input.agentId}
        RETURNING *
      `;
      return updated;
    });
    return row ? agentFromRow(row, await this.listExperiences(row.id)) : null;
  }

  async selfUpdateAgent(agentId: string, input: SelfUpdateAgentInput): Promise<Agent | null> {
    const writesAvatar = input.avatar !== undefined;
    const [row] = await this.db<AgentRow[]>`
      UPDATE agents
      SET
        persona = COALESCE(${input.persona ?? null}, persona),
        avatar_mark = CASE
          WHEN ${writesAvatar} THEN ${input.avatar?.mark ?? null}
          ELSE avatar_mark
        END,
        avatar_color = CASE
          WHEN ${writesAvatar} THEN ${input.avatar?.color ?? null}
          ELSE avatar_color
        END
      WHERE id = ${agentId}
      RETURNING *
    `;
    return row ? agentFromRow(row, await this.listExperiences(agentId)) : null;
  }

  async listExperiences(agentId: string): Promise<AgentExperience[]> {
    const rows = await this.db<AgentExperienceRow[]>`
      SELECT * FROM agent_experiences
      WHERE agent_id = ${agentId}
      ORDER BY created_at DESC, id
    `;
    return rows.map(experienceFromRow);
  }

  async manageExperience(
    agentId: string,
    change: ManageAgentExperienceInput,
  ): Promise<Agent | null> {
    if (change.action === "add") {
      const now = new Date().toISOString();
      await this.db<AgentExperienceRow[]>`
        INSERT INTO agent_experiences (id, agent_id, content, created_at)
        VALUES (
          ${`${EXPERIENCE_ID_PREFIX}${crypto.randomUUID()}`}, ${agentId}, ${change.content},
          ${now}
        )
        ON CONFLICT(agent_id, content) DO NOTHING
      `;
    } else if (change.action === "update") {
      const rows = await this.db<{ id: string }[]>`
        UPDATE agent_experiences
        SET content = ${change.content}
        WHERE id = ${change.experienceId} AND agent_id = ${agentId}
        RETURNING id
      `;
      if (rows.length === 0) return null;
    } else {
      const rows = await this.db<{ id: string }[]>`
        DELETE FROM agent_experiences
        WHERE id = ${change.experienceId} AND agent_id = ${agentId}
        RETURNING id
      `;
      if (rows.length === 0) return null;
    }
    return this.getAgent(agentId);
  }

  async deleteAgent(agentId: string): Promise<boolean> {
    const rows = await this.db<{ id: string }[]>`
      DELETE FROM agents WHERE id = ${agentId} RETURNING id
    `;
    return rows.length > 0;
  }

  async listMemberships(host: AgentHost): Promise<AgentMembership[]> {
    const { hostKind, hostId } = hostColumns(host);
    const rows = await this.db<AgentMembershipRow[]>`
      SELECT membership.*
      FROM agent_memberships AS membership
      WHERE membership.host_kind = ${hostKind} AND membership.host_id = ${hostId}
      ORDER BY membership.session_id
    `;
    return rows.map(membershipFromRow);
  }

  async getMembership(host: AgentHost, agentId: string): Promise<AgentMembership | null> {
    const { hostKind, hostId } = hostColumns(host);
    const [row] = await this.db<AgentMembershipRow[]>`
      SELECT membership.*
      FROM agent_memberships AS membership
      WHERE membership.host_kind = ${hostKind}
        AND membership.host_id = ${hostId}
        AND membership.agent_id = ${agentId}
    `;
    return row ? membershipFromRow(row) : null;
  }

  async getMembershipBySession(sessionId: string): Promise<AgentMembership | null> {
    const [row] = await this.db<AgentMembershipRow[]>`
      SELECT membership.*
      FROM agent_memberships AS membership
      WHERE membership.session_id = ${sessionId}
    `;
    return row ? membershipFromRow(row) : null;
  }

  async createMembership(input: {
    host: AgentHost;
    agentId: string;
    sessionId: string;
    executionMode: AgentMembership["executionMode"];
  }): Promise<AgentMembership> {
    const { hostKind, hostId } = hostColumns(input.host);
    await this.db`
      INSERT INTO agent_memberships (
        session_id, agent_id, host_kind, host_id, execution_mode
      ) VALUES (
        ${input.sessionId}, ${input.agentId}, ${hostKind}, ${hostId}, ${input.executionMode}
      )
    `;
    return input;
  }

  async deleteMembershipBySession(sessionId: string): Promise<boolean> {
    const rows = await this.db<{ session_id: string }[]>`
      DELETE FROM agent_memberships WHERE session_id = ${sessionId} RETURNING session_id
    `;
    return rows.length > 0;
  }

  async listSessionOwnedMembershipSessionIds(sessionId: string): Promise<string[]> {
    const rows = await this.db<{ session_id: string }[]>`
      SELECT session_id FROM agent_memberships
      WHERE (host_kind = 'session' AND host_id = ${sessionId})
         OR (
           host_kind = 'file'
           AND json_extract(host_id, '$.sessionId') = ${sessionId}
         )
      ORDER BY session_id
    `;
    return rows.map((row) => row.session_id);
  }

  async listAgentMembershipSessionIds(agentId: string): Promise<string[]> {
    const rows = await this.db<{ session_id: string }[]>`
      SELECT session_id FROM agent_memberships
      WHERE agent_id = ${agentId}
      ORDER BY session_id
    `;
    return rows.map((row) => row.session_id);
  }

  async listAgentSessionIds(): Promise<string[]> {
    const rows = await this.db<{ session_id: string }[]>`
      SELECT session_id FROM agent_memberships ORDER BY session_id
    `;
    return rows.map((row) => row.session_id);
  }
}

async function assertAgentNameAvailable(
  db: Bun.SQL,
  name: string,
  exceptAgentId?: string,
): Promise<void> {
  const handle = agentHandleFromName(name);
  const agents = await db<{ id: string; name: string }[]>`SELECT id, name FROM agents`;
  const conflict = agents.find(
    (agent) => agent.id !== exceptAgentId && agentHandleFromName(agent.name) === handle,
  );
  if (conflict) {
    throw new Error(`${conflict.name} already uses the @${handle} mention.`);
  }
}

function groupExperiences(rows: AgentExperienceRow[]): Map<string, AgentExperience[]> {
  const grouped = new Map<string, AgentExperience[]>();
  for (const row of rows) {
    const experiences = grouped.get(row.agent_id) ?? [];
    experiences.push(experienceFromRow(row));
    grouped.set(row.agent_id, experiences);
  }
  return grouped;
}

function hostColumns(host: AgentHost): {
  hostKind: AgentHost["kind"];
  hostId: string;
} {
  return { hostKind: host.kind, hostId: agentHostId(host) };
}

type AgentRow = {
  id: string;
  name: string;
  persona: string | null;
  model_configuration: string | null;
  avatar_mark: AgentAvatar["mark"] | null;
  avatar_color: AgentAvatar["color"] | null;
};

type AgentExperienceRow = {
  id: string;
  agent_id: string;
  content: string;
  created_at: string;
};

type AgentHostRow = {
  host_kind: AgentHost["kind"];
  host_id: string;
};

type AgentMembershipRow = AgentHostRow & {
  agent_id: string;
  session_id: string;
  execution_mode: AgentMembership["executionMode"];
};

function agentFromRow(row: AgentRow, experiences: AgentExperience[]): Agent {
  const model = parseSerializedModelConfiguration(row.model_configuration);
  return {
    id: row.id,
    name: row.name,
    ...(row.persona ? { persona: row.persona } : {}),
    ...(model ? { model } : {}),
    ...(row.avatar_mark && row.avatar_color
      ? { avatar: { mark: row.avatar_mark, color: row.avatar_color } }
      : {}),
    experiences,
  };
}

function experienceFromRow(row: AgentExperienceRow): AgentExperience {
  return {
    id: row.id,
    content: row.content,
  };
}

function membershipFromRow(row: AgentMembershipRow): AgentMembership {
  return {
    host: agentHostFromRow(row),
    agentId: row.agent_id,
    sessionId: row.session_id,
    executionMode: row.execution_mode,
  };
}

function agentHostFromRow(row: AgentHostRow): AgentHost {
  switch (row.host_kind) {
    case "session":
      return { kind: "session", sessionId: row.host_id };
    case "channel":
      return { kind: "channel", channelId: row.host_id };
    case "file":
      return fileAgentHostSchema.parse({ kind: "file", ...JSON.parse(row.host_id) });
  }
}
