import { z } from "zod";
import { modelConfigurationSchema } from "@providers/model";
import { hasChanges } from "./changes";

const durableIdSchema = z.string().trim().min(1).max(255);
export const agentNameSchema = z.string().trim().min(1).max(80);
export const agentRoleSchema = z
  .string()
  .trim()
  .min(1)
  .max(8_000)
  .describe(
    "The member's role in the channel, including any necessary persona or behavioral details.",
  );

const agentAvatarMarkSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .regex(/^[MmZzLlHhVvCcSsQqTtAaEe0-9.,+\-\s]+$/, "Use SVG path data only.")
  .describe(
    "SVG path data for a distinctive outline mark in a 24 by 24 viewBox. Multiple subpaths are allowed. Keep the mark recognizable at 20 pixels.",
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

export type AgentAvatar = z.output<typeof agentAvatarSchema>;

export const CHANNEL_LEAD_PROFILE = {
  name: "Lead",
  role: "Own the channel purpose and coordinate the work.",
  avatar: {
    mark: "M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3z",
    color: "#0891b2",
  },
} as const;

/** The name shown for an agent that has since been removed from its Channel. */
export const DELETED_AGENT_NAME = "Deleted agent";

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

export function agentMatchesMentionQuery(
  agent: { name: string; role?: string },
  query: string,
): boolean {
  const normalized = query.toLowerCase();
  return [agentHandleFromName(agent.name), agent.name, agent.role ?? ""].some((value) =>
    value.toLowerCase().includes(normalized),
  );
}

const LEADING_MENTION = /^\s*@([a-z0-9][a-z0-9-]*)(?=[\s,:]|$)[\s,:]*/i;

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
