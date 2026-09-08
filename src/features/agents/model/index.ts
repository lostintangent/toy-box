import { z } from "zod";
import {
  modelConfigurationSchema,
  type ModelConfiguration,
} from "@sessions/model/modelConfiguration";

const durableIdSchema = z.string().trim().min(1).max(255);
const agentNameSchema = z.string().trim().min(1).max(80);
const agentPersonaSchema = z.string().trim().min(1).max(8_000);
const agentExperienceContentSchema = z.string().trim().min(1).max(2_000);

const agentAvatarMarkSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .regex(/^[MmZzLlHhVvCcSsQqTtAaEe0-9.,+\-\s]+$/, "Use SVG path data only.")
  .describe(
    "SVG path data for a distinctive outline mark in a 24 by 24 viewBox. Multiple subpaths are allowed; keep the mark recognizable at 20 pixels.",
  );
const agentAvatarColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i)
  .describe("A six-digit hex background color chosen to express this Agent's identity.");
export const agentAvatarSchema = z
  .object({
    mark: agentAvatarMarkSchema,
    color: agentAvatarColorSchema,
  })
  .strict();

export const agentExecutionModeSchema = z.enum(["shared", "worktree"]);

export const fileAgentHostSchema = z
  .object({
    kind: z.literal("file"),
    sessionId: durableIdSchema,
    path: z.string().min(1),
  })
  .strict();

export const agentHostSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("session"), sessionId: durableIdSchema }).strict(),
  z.object({ kind: z.literal("channel"), channelId: durableIdSchema }).strict(),
  fileAgentHostSchema,
]);

/** Address one Agent. Execution mode only initializes a new membership. */
export const agentMentionSchema = z
  .object({
    agentId: durableIdSchema,
    initialExecutionMode: agentExecutionModeSchema.optional(),
  })
  .strict();

export type AgentAvatar = z.output<typeof agentAvatarSchema>;

export type AgentExperience = {
  id: string;
  content: string;
};

/** A durable teammate whose identity and experience travel across projects. */
export type Agent = {
  id: string;
  name: string;
  /** Established by the Agent during its first host engagement. */
  persona?: string;
  /** Unset agents inherit the workspace default whenever a private turn starts. */
  model?: ModelConfiguration;
  avatar?: AgentAvatar;
  experiences: AgentExperience[];
};

export type AgentHost = z.infer<typeof agentHostSchema>;
export type AgentExecutionMode = z.infer<typeof agentExecutionModeSchema>;
export type AgentMention = z.output<typeof agentMentionSchema>;

/** One Agent's durable presence and private Session within one host. */
export type AgentMembership = {
  host: AgentHost;
  agentId: string;
  sessionId: string;
  executionMode: AgentExecutionMode;
};

/** Stable identity within one Agent host kind. */
export function agentHostId(host: AgentHost): string {
  switch (host.kind) {
    case "session":
      return host.sessionId;
    case "channel":
      return host.channelId;
    case "file":
      return JSON.stringify({ sessionId: host.sessionId, path: host.path });
  }
}

export type AgentEvent =
  | { type: "agent.changed" }
  | {
      type: "agent.membership.changed";
      host: AgentHost;
    };

export const createAgentInputSchema = z
  .object({
    name: agentNameSchema,
    persona: agentPersonaSchema.optional(),
  })
  .strict();

export const updateAgentInputSchema = z
  .object({
    agentId: durableIdSchema,
    name: agentNameSchema.optional(),
    persona: agentPersonaSchema.optional(),
    model: modelConfigurationSchema.nullable().optional(),
  })
  .strict()
  .refine(
    ({ name, persona, model }) =>
      name !== undefined || persona !== undefined || model !== undefined,
    { message: "At least one agent field must be updated." },
  );

export const deleteAgentInputSchema = z.object({ agentId: durableIdSchema }).strict();

const updateAgentExperienceInputSchema = z
  .object({
    action: z.literal("update"),
    experienceId: durableIdSchema,
    content: agentExperienceContentSchema,
  })
  .strict();
const deleteAgentExperienceInputSchema = z
  .object({ action: z.literal("delete"), experienceId: durableIdSchema })
  .strict();

// Keep the generated schema object-rooted so Copilot exposes the tool to the model.
export const manageAgentExperienceInputSchema = z
  .object({
    action: z.enum(["add", "update", "delete"]),
    experienceId: durableIdSchema
      .optional()
      .describe("Required when updating or deleting an experience."),
    content: agentExperienceContentSchema
      .optional()
      .describe("Required when adding or updating an experience."),
  })
  .strict()
  .refine(
    ({ action, experienceId, content }) =>
      (action === "add" && content !== undefined && experienceId === undefined) ||
      (action === "update" && experienceId !== undefined && content !== undefined) ||
      (action === "delete" && experienceId !== undefined && content === undefined),
    {
      message:
        "Add requires content; update requires an experience ID and content; delete requires an experience ID.",
    },
  );

export const manageAgentExperienceRequestSchema = z
  .object({
    agentId: durableIdSchema,
    change: z.discriminatedUnion("action", [
      updateAgentExperienceInputSchema,
      deleteAgentExperienceInputSchema,
    ]),
  })
  .strict();

export const selfUpdateAgentInputSchema = z
  .object({
    persona: agentPersonaSchema.optional(),
    avatar: agentAvatarSchema.optional(),
  })
  .strict()
  .refine(({ persona, avatar }) => persona !== undefined || avatar !== undefined, {
    message: "A persona or avatar change is required.",
  });

export const listAgentMembershipsInputSchema = z.object({ host: agentHostSchema }).strict();

export type CreateAgentInput = z.output<typeof createAgentInputSchema>;
export type UpdateAgentInput = z.output<typeof updateAgentInputSchema>;
export type SelfUpdateAgentInput = z.output<typeof selfUpdateAgentInputSchema>;
export type ManageAgentExperienceInput = z.output<typeof manageAgentExperienceInputSchema>;
export type ManageAgentExperienceRequest = z.output<typeof manageAgentExperienceRequestSchema>;

export type AgentMentionToken = {
  start: number;
  end: number;
  query: string;
};

type AgentMentionTextSegment =
  | { type: "text"; content: string }
  | { type: "mention"; content: string; handle: string };

export function agentHandleFromName(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return normalized === "everyone" ? "everyone-agent" : normalized || "teammate";
}

export function extractAgentMentionHandles(content: string): {
  handles: string[];
  mentionAll: boolean;
} {
  const handles = new Set<string>();
  let mentionAll = false;
  for (const match of content.matchAll(/(^|[^a-z0-9-])@([a-z0-9][a-z0-9-]*)/gi)) {
    const handle = match[2]?.toLowerCase();
    if (!handle) continue;
    if (handle === "everyone") mentionAll = true;
    else handles.add(handle);
  }
  return { handles: [...handles], mentionAll };
}

/** Resolve explicit handles without giving regular Sessions Channel-style broadcast semantics. */
export function findMentionedAgents(content: string, agents: readonly Agent[]): Agent[] {
  const { handles } = extractAgentMentionHandles(content);
  const handleSet = new Set(handles);
  return agents.filter(({ name }) => handleSet.has(agentHandleFromName(name)));
}

/** Find the incomplete mention immediately before a text caret. */
export function findAgentMentionToken(
  content: string,
  caret: number,
): AgentMentionToken | undefined {
  const boundedCaret = Math.max(0, Math.min(content.length, caret));
  const prefix = content.slice(0, boundedCaret);
  const match = prefix.match(/(?:^|[^a-z0-9-])@([a-z0-9-]*)$/i);
  if (!match) return undefined;
  const query = match[1] ?? "";
  return {
    start: boundedCaret - query.length - 1,
    end: boundedCaret,
    query: query.toLowerCase(),
  };
}

export function agentMatchesMentionQuery(agent: Agent, query: string): boolean {
  const normalized = query.toLowerCase();
  return [agentHandleFromName(agent.name), agent.name, agent.persona ?? ""].some((value) =>
    value.toLowerCase().includes(normalized),
  );
}

/** Preserve user-authored text while identifying mention spans for presentation. */
export function splitAgentMentionText(content: string): AgentMentionTextSegment[] {
  const segments: AgentMentionTextSegment[] = [];
  let cursor = 0;
  for (const match of content.matchAll(/(^|[^a-z0-9-])@([a-z0-9][a-z0-9-]*)/gi)) {
    const matchStart = match.index ?? 0;
    const mentionStart = matchStart + (match[1]?.length ?? 0);
    const mentionEnd = mentionStart + (match[2]?.length ?? 0) + 1;
    if (mentionStart > cursor) {
      segments.push({ type: "text", content: content.slice(cursor, mentionStart) });
    }
    segments.push({
      type: "mention",
      content: content.slice(mentionStart, mentionEnd),
      handle: (match[2] ?? "").toLowerCase(),
    });
    cursor = mentionEnd;
  }
  if (cursor < content.length || segments.length === 0) {
    segments.push({ type: "text", content: content.slice(cursor) });
  }
  return segments;
}
