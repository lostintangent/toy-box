import { z } from "zod";
import type { Agent, AgentMembership, AgentMention } from "@agents/model";
import { agentHandleFromName, agentMentionSchema, extractAgentMentionHandles } from "@agents/model";
import type { WorkspaceFile } from "@files/model";
import { messageAttachmentsSchema, type Attachment } from "@sessions/model/protocol";

const durableIdSchema = z.string().trim().min(1).max(255);
const channelTitleSchema = z.string().trim().min(1).max(100);
const channelMessageTextSchema = z.string().trim().max(12_000);
export const channelMessageContentSchema = channelMessageTextSchema.min(1);
export const channelReactionKindSchema = z.enum(["looking", "agree", "celebrate", "love", "laugh"]);

export const channelReactionSchema = z
  .object({
    agentId: durableIdSchema,
    reaction: channelReactionKindSchema,
  })
  .strict();

export type Channel = {
  id: string;
  title: string;
  directory?: string;
  latestSequence: number;
  seenThrough: number;
  updatedAt: string;
};

export type ChannelMember = AgentMembership & {
  host: { kind: "channel"; channelId: string };
  seenThrough: number;
};

export type ChannelMessageSender =
  | { type: "user" }
  | { type: "agent"; agentId: string }
  | { type: "system" };

export type ChannelReaction = z.output<typeof channelReactionSchema>;

export type ChannelMessage = {
  id: string;
  sequence: number;
  sender: ChannelMessageSender;
  content: string;
  attachments?: Attachment[];
  reactions: ChannelReaction[];
  timestamp: string;
};

export type ChannelArtifact = {
  file: WorkspaceFile;
  title: string;
};

export type ChannelSnapshot = {
  cursor: number;
  members: ChannelMember[];
  messages: ChannelMessage[];
  artifacts: ChannelArtifact[];
};

export type ChannelEvent = (
  | { type: "snapshot"; snapshot: ChannelSnapshot }
  | {
      type: "message";
      message: ChannelMessage;
    }
  | {
      type: "reaction";
      sequence: number;
      agentId: string;
      reaction: ChannelReaction["reaction"] | null;
    }
  | { type: "member_added"; member: ChannelMember }
  | { type: "member_removed"; sessionId: string }
  | {
      type: "artifact";
      artifact: ChannelArtifact;
    }
) & { cursor: number };

export const createChannelInputSchema = z
  .object({
    title: channelTitleSchema,
    directory: z.string().trim().min(1).max(4_096).optional(),
  })
  .strict();

export const channelIdentitySchema = z.object({ channelId: durableIdSchema }).strict();

export const removeChannelMemberInputSchema = channelIdentitySchema.extend({
  sessionId: durableIdSchema,
});

export const renameChannelInputSchema = z
  .object({ channelId: durableIdSchema, title: channelTitleSchema })
  .strict();

export const postChannelMessageInputSchema = z
  .object({
    id: durableIdSchema,
    channelId: durableIdSchema,
    content: channelMessageTextSchema,
    attachments: messageAttachmentsSchema.optional(),
    agentMentions: z.array(agentMentionSchema).max(50).optional(),
  })
  .strict()
  .refine(({ content, attachments }) => content.length > 0 || (attachments?.length ?? 0) > 0, {
    message: "A message or attachment is required",
  });

export const markChannelReadInputSchema = z
  .object({ channelId: durableIdSchema, sequence: z.number().int().nonnegative() })
  .strict();

export type CreateChannelInput = z.output<typeof createChannelInputSchema>;
export type RenameChannelInput = z.output<typeof renameChannelInputSchema>;
export type PostChannelMessageInput = z.output<typeof postChannelMessageInputSchema>;

export function channelHasUnread(channel: Channel): boolean {
  return channel.latestSequence > channel.seenThrough;
}

/** Complete delivery policy, shared by the composer preview and both posting paths. */
export function resolveChannelAudience({
  content,
  sender,
  members,
  agents,
  agentMentions,
}: {
  content: string;
  sender: Exclude<ChannelMessageSender, { type: "system" }>;
  members: readonly ChannelMember[];
  agents: readonly Agent[];
  /** When supplied, stable IDs are authoritative; text still carries @everyone. */
  agentMentions?: readonly AgentMention[];
}): { members: ChannelMember[]; invitations: Agent[] } {
  const { handles, mentionAll } = extractAgentMentionHandles(content);
  const mentionedHandles = new Set(handles);
  const mentionedIds = new Set(
    agentMentions !== undefined
      ? agentMentions.map(({ agentId }) => agentId)
      : agents
          .filter(({ name }) => mentionedHandles.has(agentHandleFromName(name)))
          .map(({ id }) => id),
  );
  const hasMentions = mentionAll || handles.length > 0 || mentionedIds.size > 0;
  const broadcast = mentionAll || (sender.type === "user" && !hasMentions);
  const senderId = sender.type === "agent" ? sender.agentId : undefined;
  const memberIds = new Set(members.map(({ agentId }) => agentId));
  return {
    members: members.filter(
      ({ agentId }) => agentId !== senderId && (broadcast || mentionedIds.has(agentId)),
    ),
    invitations: agents.filter(
      ({ id }) => id !== senderId && !memberIds.has(id) && mentionedIds.has(id),
    ),
  };
}
