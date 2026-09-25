import { z } from "zod";
import { workspaceFileSchema } from "@files/model";
import { modelConfigurationSchema, type ModelConfiguration } from "@providers/model";
import { attachmentSchema, attachmentsSchema } from "@/shared/attachments/model";
import {
  agentAvatarSchema,
  agentHandleFromName,
  agentNameSchema,
  agentRoleSchema,
  CHANNEL_LEAD_PROFILE,
  extractAgentMentionHandles,
} from "./agent";

export * from "./agent";

const durableIdSchema = z.string().trim().min(1).max(255);
const channelNameSchema = z.string().trim().min(1).max(100);
const channelPurposeSchema = z.string().trim().min(1).max(12_000);
const channelMessageTextSchema = z.string().trim().max(12_000);
export const channelMessageContentSchema = channelMessageTextSchema.min(1);
export const channelReactionKindSchema = z.enum(["done", "agree", "celebrate", "love", "laugh"]);
export const channelChecklistItemStatusSchema = z.enum([
  "pending",
  "in_progress",
  "blocked",
  "done",
]);
export type ChannelChecklistItemStatus = z.output<typeof channelChecklistItemStatusSchema>;

export const channelChecklistItemSchema = z
  .object({
    title: z.string().trim().min(1).max(240).describe("A concise outcome or next step."),
    status: channelChecklistItemStatusSchema.describe("The item's current state."),
    ownerId: durableIdSchema
      .optional()
      .describe("The channel lead ID or current member ID responsible for the item."),
    get children() {
      return z
        .array(channelChecklistItemSchema)
        .max(50)
        .optional()
        .describe("Optional nested items.");
    },
  })
  .strict();
export type ChannelChecklistItem = z.output<typeof channelChecklistItemSchema>;

export const channelReactionSchema = z
  .object({
    agentId: durableIdSchema,
    reaction: channelReactionKindSchema,
  })
  .strict();

export type Channel = {
  id: string;
  name: string;
  purpose?: string;
  directory?: string;
  model: ModelConfiguration;
  leadId: string;
  checklist: ChannelChecklistItem[];
  previewUrl?: string;
  latestSequence: number;
  seenThrough: number;
  updatedAt: string;
};

export type ChannelList = {
  channels: Channel[];
  members: ChannelMember[];
};

const channelStatusTextSchema = z.string().trim().min(1).max(100);

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

export const channelAgentStatusSchema = z.discriminatedUnion("state", [
  channelStatusTargetSchema.safeExtend({
    state: z.literal("working"),
    text: channelStatusTextSchema,
  }),
  z.object({ state: z.literal("waiting"), text: channelStatusTextSchema }).strict(),
]);
export type ChannelAgentStatus = z.output<typeof channelAgentStatusSchema>;

/** Channel-owned configuration and collaboration state stored on its Worker. */
export const channelAgentMetadataSchema = z
  .object({
    role: agentRoleSchema.optional(),
    model: modelConfigurationSchema.optional(),
    avatar: agentAvatarSchema.optional(),
    seenThrough: z.number().int().nonnegative(),
    status: channelAgentStatusSchema.optional(),
  })
  .strict();
export type ChannelAgentMetadata = z.output<typeof channelAgentMetadataSchema>;

export const setChannelStatusInputSchema = channelStatusTargetSchema.safeExtend({
  status: channelStatusTextSchema.describe("A very brief description of the work being performed."),
});
export type SetChannelStatusInput = z.output<typeof setChannelStatusInputSchema>;

const channelMemberSchema = channelAgentMetadataSchema
  .omit({ seenThrough: true })
  .extend({
    channelId: durableIdSchema,
    id: durableIdSchema,
    name: agentNameSchema,
  })
  .strict();
export type ChannelMember = z.output<typeof channelMemberSchema>;

export type ChannelAgent = Pick<ChannelMember, "id" | "name" | "role" | "avatar" | "status">;
export type ChannelLead = ChannelAgent & {
  role: string;
  avatar: NonNullable<ChannelAgent["avatar"]>;
};

export function channelLead(id: string, status?: ChannelAgentStatus): ChannelLead {
  return {
    id,
    ...CHANNEL_LEAD_PROFILE,
    ...(status ? { status } : {}),
  };
}

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
  lead: ChannelLead;
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
  | { type: "member"; member: ChannelMember }
  | { type: "status"; agentId: string; status?: ChannelAgent["status"] }
) & { revision: number };

export const createChannelInputSchema = z
  .object({
    name: channelNameSchema,
    purpose: channelPurposeSchema
      .optional()
      .describe("What the channel is for. Omit it to let the lead ask the user."),
    directory: z.string().trim().min(1).max(4_096).optional(),
    model: modelConfigurationSchema,
  })
  .strict();

export const channelIdentitySchema = z.object({ channelId: durableIdSchema }).strict();

export const removeChannelMemberInputSchema = z.object({ agentId: durableIdSchema }).strict();

export const renameChannelInputSchema = z
  .object({ channelId: durableIdSchema, name: channelNameSchema })
  .strict();

const channelPreviewUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine(
    (url) => {
      if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")) return true;
      try {
        return ["http:", "https:"].includes(new URL(url).protocol);
      } catch {
        return false;
      }
    },
    {
      message: "Use a root-relative, HTTP, or HTTPS preview URL.",
    },
  );

export const updateChannelInputSchema = z
  .object({
    purpose: channelPurposeSchema
      .nullable()
      .optional()
      .describe("What the channel is currently for, or null to clear it."),
    checklist: z
      .array(channelChecklistItemSchema)
      .max(50)
      .optional()
      .describe("The complete public checklist, replacing the previous checklist."),
    previewUrl: channelPreviewUrlSchema
      .nullable()
      .optional()
      .describe("The current runnable preview URL, or null to clear it."),
  })
  .strict()
  .refine(
    ({ purpose, checklist, previewUrl }) =>
      purpose !== undefined || checklist !== undefined || previewUrl !== undefined,
    {
      message: "Update the purpose, checklist, preview URL, or any combination of them.",
    },
  );

export const postChannelMessageInputSchema = z
  .object({
    id: durableIdSchema,
    channelId: durableIdSchema,
    content: channelMessageTextSchema,
    attachments: attachmentsSchema.optional(),
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
export type UpdateChannelInput = z.output<typeof updateChannelInputSchema>;

export function unassignChannelChecklist(
  checklist: readonly ChannelChecklistItem[],
  agentId: string,
): ChannelChecklistItem[] {
  return checklist.map(({ ownerId, children, ...item }) => ({
    ...item,
    ...(ownerId && ownerId !== agentId ? { ownerId } : {}),
    ...(children ? { children: unassignChannelChecklist(children, agentId) } : {}),
  }));
}

export function channelHasUnread(channel: Channel): boolean {
  return channel.latestSequence > channel.seenThrough;
}

/** Complete delivery policy for user, lead, and member messages. */
export function resolveChannelAudience({
  content,
  sender,
  lead,
  members,
}: {
  content: string;
  sender: Exclude<ChannelMessageSender, { type: "system" }>;
  lead: ChannelAgent;
  members: readonly ChannelAgent[];
}): ChannelAgent[] {
  const { handles, mentionAll } = extractAgentMentionHandles(content);
  const mentionedHandles = new Set(handles);
  const agents = [lead, ...members];
  const mentionedIds = new Set(
    agents
      .filter(({ name }) => mentionedHandles.has(agentHandleFromName(name)))
      .map(({ id }) => id),
  );
  const senderId = sender.type === "agent" ? sender.agentId : undefined;
  if (!mentionAll && handles.length === 0) {
    return lead.id === senderId ? [] : [lead];
  }
  return agents.filter(({ id }) => id !== senderId && (mentionAll || mentionedIds.has(id)));
}
