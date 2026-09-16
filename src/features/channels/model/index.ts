import { z } from "zod";
import type { Agent, AgentMembership } from "@agents/model";
import {
  agentHandleFromName,
  agentMembershipStatusSchema,
  extractAgentMentionHandles,
} from "@agents/model";
import { workspaceFileSchema } from "@files/model";
import { attachmentSchema, messageAttachmentsSchema } from "@sessions/model/protocol";

const durableIdSchema = z.string().trim().min(1).max(255);
const channelTitleSchema = z.string().trim().min(1).max(100);
const channelMessageTextSchema = z.string().trim().max(12_000);
export const channelMessageContentSchema = channelMessageTextSchema.min(1);
export const channelReactionKindSchema = z.enum(["done", "agree", "celebrate", "love", "laugh"]);

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

export type ChannelList = {
  channels: Channel[];
  memberships: AgentMembership[];
};

const channelStatusTargetSchema = z
  .object({
    lookingAt: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("The message sequence requesting review of a referenced resource."),
    workingOn: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("The message sequence requesting other substantive work."),
  })
  .strict()
  .refine(({ lookingAt, workingOn }) => lookingAt === undefined || workingOn === undefined, {
    message: "Choose either lookingAt or workingOn.",
  });

export const channelMemberStatusSchema = z.discriminatedUnion("state", [
  channelStatusTargetSchema.safeExtend({
    state: z.literal("working"),
    text: agentMembershipStatusSchema.shape.text,
  }),
  agentMembershipStatusSchema.extend({ state: z.literal("waiting") }),
]);
export type ChannelMemberStatus = z.output<typeof channelMemberStatusSchema>;

export const setChannelStatusInputSchema = channelStatusTargetSchema.safeExtend({
  status: agentMembershipStatusSchema.shape.text.describe(
    "A very brief description of the work being performed.",
  ),
});
export type SetChannelStatusInput = z.output<typeof setChannelStatusInputSchema>;

const channelMemberSchema = z
  .object({
    host: z.object({ kind: z.literal("channel"), channelId: durableIdSchema }).strict(),
    agentId: durableIdSchema,
    sessionId: durableIdSchema,
    status: channelMemberStatusSchema.optional(),
  })
  .strict();
export type ChannelMember = z.output<typeof channelMemberSchema>;

export type ChannelMessageSender =
  | { type: "user" }
  | { type: "agent"; agentId: string }
  | { type: "system" };

export type ChannelReaction = z.output<typeof channelReactionSchema>;

export const channelAttachmentSchema = z.union([attachmentSchema, z.string().min(1).max(4_096)]);
export type ChannelAttachment = z.output<typeof channelAttachmentSchema>;

export const channelArtifactSchema = z
  .object({
    file: workspaceFileSchema,
    title: z.string().trim().min(1).max(160),
  })
  .strict();
export type ChannelArtifact = z.output<typeof channelArtifactSchema>;

const channelMessageActorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user") }).strict(),
  z.object({ type: z.literal("agent"), agentId: durableIdSchema }).strict(),
]);

export const channelSystemMessageContentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("member_joined"), member: channelMemberSchema }).strict(),
  z.object({ type: z.literal("member_left"), member: channelMemberSchema }).strict(),
  z
    .object({
      type: z.literal("artifact_shared"),
      actor: channelMessageActorSchema,
      artifact: channelArtifactSchema,
    })
    .strict(),
]);
export type ChannelSystemMessageContent = z.output<typeof channelSystemMessageContentSchema>;

type ChannelMessageBase = {
  id: string;
  sequence: number;
  timestamp: string;
};

export type ChannelConversationMessage = ChannelMessageBase & {
  sender: Exclude<ChannelMessageSender, { type: "system" }>;
  content: string;
  attachments?: ChannelAttachment[];
  reactions?: ChannelReaction[];
};

export type ChannelSystemMessage = ChannelMessageBase & {
  sender: { type: "system" };
  content: ChannelSystemMessageContent;
  attachments?: never;
  reactions?: never;
};

export type ChannelMessage = ChannelConversationMessage | ChannelSystemMessage;

export function isChannelSystemMessage(message: ChannelMessage): message is ChannelSystemMessage {
  return message.sender.type === "system";
}

export type ChannelState = {
  /** Advances with every durable detail change; messages have their own sequence. */
  revision: number;
  members: ChannelMember[];
  messages: ChannelMessage[];
  artifacts: ChannelArtifact[];
};

export type ChannelEvent = (
  | { type: "state"; state: ChannelState }
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
  | { type: "status"; sessionId: string; status?: ChannelMember["status"] }
) & { revision: number };

export const createChannelInputSchema = z
  .object({
    title: channelTitleSchema,
    directory: z.string().trim().min(1).max(4_096).optional(),
  })
  .strict();

export const channelIdentitySchema = z.object({ channelId: durableIdSchema }).strict();

export const removeChannelMemberInputSchema = z.object({ sessionId: durableIdSchema }).strict();

export const renameChannelInputSchema = z
  .object({ channelId: durableIdSchema, title: channelTitleSchema })
  .strict();

export const postChannelMessageInputSchema = z
  .object({
    id: durableIdSchema,
    channelId: durableIdSchema,
    content: channelMessageTextSchema,
    attachments: messageAttachmentsSchema.optional(),
  })
  .strict()
  .refine(({ content, attachments }) => content.length > 0 || (attachments?.length ?? 0) > 0, {
    message: "A message or attachment is required",
  });

export const markChannelReadInputSchema = z
  .object({
    channelId: durableIdSchema,
    sequence: z.number().int().nonnegative(),
  })
  .strict();

export type CreateChannelInput = z.output<typeof createChannelInputSchema>;
export type RenameChannelInput = z.output<typeof renameChannelInputSchema>;
export type PostChannelMessageInput = z.output<typeof postChannelMessageInputSchema>;

export function channelHasUnread(channel: Channel): boolean {
  return channel.latestSequence > channel.seenThrough;
}

/** Complete delivery policy, shared by the composer preview and both posting paths. */
export function resolveChannelAudience<
  Member extends Pick<AgentMembership, "agentId">,
  Candidate extends Pick<Agent, "id" | "name"> = Agent,
>({
  content,
  sender,
  members,
  agents,
}: {
  content: string;
  sender: Exclude<ChannelMessageSender, { type: "system" }>;
  members: readonly Member[];
  agents: readonly Candidate[];
}): { members: Member[]; invitations: Candidate[] } {
  const { handles, mentionAll } = extractAgentMentionHandles(content);
  const mentionedHandles = new Set(handles);
  const mentionedIds = new Set(
    agents
      .filter(({ name }) => mentionedHandles.has(agentHandleFromName(name)))
      .map(({ id }) => id),
  );
  const hasMentions = mentionAll || handles.length > 0;
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
