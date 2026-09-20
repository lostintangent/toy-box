import { z } from "zod";
import { modelConfigurationSchema } from "@providers/model";

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

export const createChannelMemberInputSchema = z
  .object({
    channelId: durableIdSchema,
    name: agentNameSchema,
    role: agentRoleSchema.optional(),
    model: modelConfigurationSchema.optional(),
  })
  .strict();

export const updateAgentInputSchema = z
  .object({
    agentId: durableIdSchema,
    name: agentNameSchema.optional(),
    role: agentRoleSchema.optional(),
    model: modelConfigurationSchema.nullable().optional(),
  })
  .strict()
  .refine(
    ({ name, role, model }) => name !== undefined || role !== undefined || model !== undefined,
    { message: "At least one agent field must be updated." },
  );

export const selfUpdateAgentInputSchema = z
  .object({
    role: agentRoleSchema.optional(),
    avatar: agentAvatarSchema.optional(),
  })
  .strict()
  .refine(({ role, avatar }) => role !== undefined || avatar !== undefined, {
    message: "A role or avatar change is required.",
  });

export type CreateChannelMemberInput = z.output<typeof createChannelMemberInputSchema>;
export type UpdateAgentInput = z.output<typeof updateAgentInputSchema>;
export type SelfUpdateAgentInput = z.output<typeof selfUpdateAgentInputSchema>;

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

export function agentMatchesMentionQuery(
  agent: { name: string; role?: string },
  query: string,
): boolean {
  const normalized = query.toLowerCase();
  return [agentHandleFromName(agent.name), agent.name, agent.role ?? ""].some((value) =>
    value.toLowerCase().includes(normalized),
  );
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
