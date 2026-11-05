import { z } from "zod";
import { modelConfigurationSchema } from "@providers/model";
import { hasChanges } from "./changes";
import type { ChannelAgent } from ".";

const durableIdSchema = z.string().trim().min(1).max(255);
export const agentNameSchema = z.string().trim().min(1).max(80);
export const agentRoleSchema = z
  .string()
  .trim()
  .min(1)
  .max(8_000)
  .describe(
    "What the member is accountable for, the quality bar, and judgment specific to that work, in about 150 words. Assignments carry task context. Leave out shared rules, paths, commands, and product specs.",
  );

const agentAvatarMarkSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .regex(/^[MmZzLlHhVvCcSsQqTtAaEe0-9.,+\-\s]+$/, "Use SVG path data only.")
  .describe(
    "SVG path data for a distinctive outline mark in a 24 by 24 viewBox, drawn with a 2.25-unit round stroke. Express one idea in two to four strokes. Keep parallel strokes at least 3 units apart, and avoid text lines, dots and tiny details. The mark must stay recognizable at 16 pixels.",
  );

export const agentAvatarSchema = z
  .object({
    mark: agentAvatarMarkSchema,
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .describe("A six-digit hex background color chosen to express this agent's identity."),
  })
  .strict();

/**
 * An agent's rendered avatar. Agents author only the mark and background, so their ink contrasts
 * automatically. Toy Box's own profiles may also fix the ink, which clients use for the mark.
 */
export type AgentAvatar = z.output<typeof agentAvatarSchema> & { ink?: string };

export const CHANNEL_LEAD_PROFILE = {
  name: "Lead",
  role: "Own the channel purpose and coordinate the work.",
  avatar: {
    mark: "M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3z",
    color: "#1e3a8a",
    ink: "#facc15",
  },
} as const satisfies { name: string; role: string; avatar: AgentAvatar };

/** The name shown for an agent that has since been removed from its Channel. */
export const DELETED_AGENT_NAME = "Deleted agent";

/** An agent that authored, reacted to, or owns something: a current teammate, or one since removed. */
export type ChannelAgentIdentity = ChannelAgent & { deleted?: true };

/** History outlives membership, so an ID without a current agent resolves to a deleted identity. */
export function channelAgentIdentity(
  agents: readonly ChannelAgent[],
  id: string,
): ChannelAgentIdentity {
  return agents.find((agent) => agent.id === id) ?? { id, name: DELETED_AGENT_NAME, deleted: true };
}

export const createChannelMemberInputSchema = z
  .object({
    channelId: durableIdSchema,
    name: agentNameSchema,
    role: agentRoleSchema.optional(),
    model: modelConfigurationSchema.optional(),
  })
  .strict();

const channelMemberChangesSchema = z
  .object({
    name: agentNameSchema.optional(),
    role: agentRoleSchema.optional(),
    model: modelConfigurationSchema.nullable().optional(),
    avatar: agentAvatarSchema.optional(),
  })
  .strict();
export type ChannelMemberChanges = z.output<typeof channelMemberChangesSchema>;

export const updateChannelMemberInputSchema = channelMemberChangesSchema
  .omit({ avatar: true })
  .extend({ agentId: durableIdSchema })
  .refine(({ agentId: _agentId, ...changes }) => hasChanges(changes), {
    message: "At least one member field must be updated.",
  });

export const selfUpdateChannelMemberInputSchema = channelMemberChangesSchema
  .pick({ role: true, avatar: true })
  .refine(hasChanges, {
    message: "A role or avatar change is required.",
  });

export type CreateChannelMemberInput = z.output<typeof createChannelMemberInputSchema>;
export type UpdateChannelMemberInput = z.output<typeof updateChannelMemberInputSchema>;

type AgentMentionTextSegment =
  | { type: "text"; content: string }
  | { type: "mention"; content: string; handle: string };

// One mention grammar for parsing, delivery, and completion: `@handle` after a non-handle
// character, so addresses like `dev@example.com` stay text.
const HANDLE = "[a-z0-9][a-z0-9-]*";
const MENTION_BOUNDARY = "(?:^|[^a-z0-9-])";
const AGENT_MENTION = new RegExp(`${MENTION_BOUNDARY}@(${HANDLE})`, "gi");
/** A mention as it is typed, including before its handle's first character. */
export const AGENT_MENTION_TRIGGER = new RegExp(`${MENTION_BOUNDARY}@([a-z0-9-]*)`, "i");
const LEADING_MENTION = new RegExp(`^\\s*@(${HANDLE})(?=[\\s,:]|$)[\\s,:]*`, "i");

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

/** Tools name an agent by its ID or its mention, and both resolve to the ID that is stored. */
export function resolveChannelAgentId(
  agents: readonly Pick<ChannelAgent, "id" | "name">[],
  reference: string,
): string | undefined {
  const handle = reference.replace(/^@/, "").toLowerCase();
  return (
    agents.find(({ id }) => id === reference) ??
    agents.find(({ name }) => agentHandleFromName(name) === handle)
  )?.id;
}

export function extractAgentMentionHandles(content: string): {
  handles: string[];
  mentionAll: boolean;
} {
  const handles = new Set<string>();
  let mentionAll = false;
  for (const match of content.matchAll(AGENT_MENTION)) {
    const handle = match[1]!.toLowerCase();
    if (handle === "everyone") mentionAll = true;
    else handles.add(handle);
  }
  return { handles: [...handles], mentionAll };
}

export function agentMatchesMentionQuery(
  agent: { name: string; role?: string },
  query: string,
): boolean {
  const normalized = query.toLowerCase();
  return [agentHandleFromName(agent.name), agent.name, agent.role ?? ""].some((value) =>
    value.toLowerCase().includes(normalized),
  );
}

/**
 * A message without the mentions it opens with, as agents address one another, so a header can name
 * the addressees instead. They stay when one names no current agent or nothing follows them.
 */
export function withoutLeadingMentions(
  content: string,
  agents: readonly { name: string }[],
): string {
  const handles = new Set(["everyone", ...agents.map(({ name }) => agentHandleFromName(name))]);
  let body = content;
  for (let match = LEADING_MENTION.exec(body); match; match = LEADING_MENTION.exec(body)) {
    if (!handles.has(match[1]!.toLowerCase())) return content;
    body = body.slice(match[0].length);
  }
  return body || content;
}

export function splitAgentMentionText(content: string): AgentMentionTextSegment[] {
  const segments: AgentMentionTextSegment[] = [];
  let cursor = 0;
  for (const match of content.matchAll(AGENT_MENTION)) {
    const handle = match[1]!;
    const mentionEnd = match.index + match[0].length;
    const mentionStart = mentionEnd - handle.length - 1;
    if (mentionStart > cursor) {
      segments.push({ type: "text", content: content.slice(cursor, mentionStart) });
    }
    segments.push({
      type: "mention",
      content: content.slice(mentionStart, mentionEnd),
      handle: handle.toLowerCase(),
    });
    cursor = mentionEnd;
  }
  if (cursor < content.length || segments.length === 0) {
    segments.push({ type: "text", content: content.slice(cursor) });
  }
  return segments;
}
