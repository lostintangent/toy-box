import { z } from "zod";
import { workspaceFileSchema } from "@files/model";
import { modelConfigurationSchema, type ModelConfiguration } from "@providers/model";
import {
  attachmentsSchema,
  type Attachment,
  type AttachmentReference,
} from "@/shared/attachments/model";
import { cronSchema } from "@/shared/cron";
import type { ChannelAgentPresence } from "./presence";
import { hasChanges } from "./changes";
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
const channelDirectorySchema = z.string().trim().min(1).max(4_096);
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

const channelMessageTextSchema = z.string().trim().max(12_000);
export const channelMessageContentSchema = channelMessageTextSchema.min(1);
export const channelReactionKindSchema = z.enum(["done", "agree", "celebrate", "love", "laugh"]);
const channelTaskStatusSchema = z.enum(["pending", "in_progress", "blocked", "done"]);

export const channelTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(240).describe("A concise outcome or next step."),
    status: channelTaskStatusSchema.describe("The task's current state."),
    ownerId: durableIdSchema
      .optional()
      .describe("The channel lead ID or current member ID responsible for the task."),
    get children() {
      return z.array(channelTaskSchema).max(50).optional().describe("Optional subtasks.");
    },
  })
  .strict();
export type ChannelTask = z.output<typeof channelTaskSchema>;

const channelReactionSchema = z
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
  tasks: ChannelTask[];
  previewUrl?: string;
  latestSequence: number;
  seenThrough: number;
  /** Transcript-derived: reading acknowledges completed tasks; user replies acknowledge requests. */
  completedSequence: number | null;
  requestSequence: number | null;
  updatedAt: string;
};

/** Attention refers to transcript milestones; reading never answers a request. */
export function channelHasUnreadCompletion(channel: Channel): boolean {
  return (channel.completedSequence ?? 0) > channel.seenThrough;
}

export function channelHasPendingRequest(channel: Channel): boolean {
  return channel.requestSequence !== null;
}

export function channelStatus(channel: Channel): "waiting" | "finished" | "unread" | null {
  if (channelHasPendingRequest(channel)) return "waiting";
  if (channelHasUnreadCompletion(channel)) return "finished";
  if (channelHasUnread(channel)) return "unread";
  return null;
}

export type ChannelList = {
  channels: Channel[];
  members: Pick<ChannelMember, "id" | "channelId" | "name" | "avatar">[];
};

/** The catalog identifies teammates; their live details belong to the open Channel. */
export function channelMemberIdentity({
  id,
  channelId,
  name,
  avatar,
}: ChannelMember): ChannelList["members"][number] {
  return { id, channelId, name, ...(avatar ? { avatar } : {}) };
}

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
  z
    .object({
      state: z.literal("waiting"),
      text: channelStatusTextSchema,
      /** A lead follow-up: when to wake if nothing else wakes it first. */
      wakeAt: z.iso.datetime().optional(),
    })
    .strict(),
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

export const setChannelAgentStatusInputSchema = channelStatusTargetSchema.safeExtend({
  status: channelStatusTextSchema.describe("A very brief description of the work being performed."),
});
export type SetChannelAgentStatusInput = z.output<typeof setChannelAgentStatusInputSchema>;

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

export function compareChannelAgents(
  left: Pick<ChannelAgent, "name" | "id">,
  right: Pick<ChannelAgent, "name" | "id">,
): number {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

export function channelLead(id: string, status?: ChannelAgentStatus): ChannelLead {
  return {
    id,
    ...CHANNEL_LEAD_PROFILE,
    ...(status ? { status } : {}),
  };
}

export type ChannelMessageSender = ChannelMessageActor | { type: "system" };

export type ChannelReaction = z.output<typeof channelReactionSchema>;

/** Client attachments carry either uploaded bytes or one resolved file address. */
export type ChannelAttachment = Attachment | AttachmentReference;

/** A shared file. Sharing it again only changes its title, never when it was first shared. */
const channelArtifactSchema = z
  .object({
    file: workspaceFileSchema,
    title: z.string().trim().min(1).max(160),
    sharedAt: z.string(),
  })
  .strict();
export type ChannelArtifact = z.output<typeof channelArtifactSchema> & {
  /** Public resource address supplied by the server; never accepted as a command input. */
  url?: string;
};

const channelMessageActorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user") }).strict(),
  z.object({ type: z.literal("agent"), agentId: durableIdSchema }).strict(),
]);

/** A titled, recurring prompt that privately wakes the lead. Only the lead adds or changes one. */
export const channelRoutineInputSchema = z
  .object({
    title: z.string().trim().min(1).max(80).describe("A short name for the routine."),
    schedule: cronSchema
      // One fixed minute can match at most once an hour.
      .refine(
        (schedule) => /^\d+(\s+\S+){4}$/.test(schedule),
        "Routines run at most hourly. Use a 5-field cron with one fixed minute, like 0 9 * * 1-5.",
      )
      .describe("A 5-field cron in local time with one fixed minute, like 0 9 * * 1-5."),
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .describe("What to check or do each time the routine wakes you."),
  })
  .strict();

const channelRoutineSchema = channelRoutineInputSchema.extend({ id: durableIdSchema });
export type ChannelRoutine = z.output<typeof channelRoutineSchema>;

export const setChannelRoutineInputSchema = channelRoutineInputSchema.extend({
  routineId: durableIdSchema.optional().describe("The routine to change. Omit it to add one."),
});
export type SetChannelRoutineInput = z.output<typeof setChannelRoutineInputSchema>;

export const channelRoutineIdentitySchema = z
  .object({ channelId: durableIdSchema, routineId: durableIdSchema })
  .strict();

export const channelSystemMessageContentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tasks_completed") }).strict(),
  z.object({ type: z.literal("member_joined"), member: channelMemberSchema }).strict(),
  z.object({ type: z.literal("member_left"), member: channelMemberSchema }).strict(),
  z
    .object({
      type: z.literal("channel_renamed"),
      actor: channelMessageActorSchema,
      name: channelNameSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("channel_purpose_changed"),
      actor: channelMessageActorSchema,
      purpose: channelPurposeSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("channel_directory_changed"),
      actor: channelMessageActorSchema,
      directory: channelDirectorySchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("preview_changed"),
      actor: channelMessageActorSchema,
      previewUrl: channelPreviewUrlSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("artifact_shared"),
      actor: channelMessageActorSchema,
      // The message's own timestamp records when it was shared.
      artifact: channelArtifactSchema.omit({ sharedAt: true }),
    })
    .strict(),
  z
    .object({
      type: z.enum(["routine_scheduled", "routine_edited", "routine_deleted"]),
      routine: channelRoutineSchema,
    })
    .strict(),
]);
export type ChannelSystemMessageContent = z.output<typeof channelSystemMessageContentSchema>;

type ChannelMessageBase = {
  id: string;
  sequence: number;
  timestamp: string;
};

export type ChannelConversationMessage<A = ChannelAttachment> = ChannelMessageBase & {
  sender: ChannelMessageActor;
  content: string;
  /** The lead asks for the user's response; a later user message acknowledges it. */
  request?: true;
  attachments?: A[];
  reactions?: ChannelReaction[];
};

export type ChannelSystemMessage = ChannelMessageBase & {
  sender: { type: "system" };
  content: ChannelSystemMessageContent;
  attachments?: never;
  reactions?: never;
  request?: never;
};

export type ChannelMessage<A = ChannelAttachment> =
  | ChannelConversationMessage<A>
  | ChannelSystemMessage;

export function isChannelSystemMessage(
  message: ChannelMessage<unknown>,
): message is ChannelSystemMessage {
  return message.sender.type === "system";
}

/** Canonical reduced state of one Channel; a snapshot is this value at one revision. */
export type ChannelState = {
  /** Advances with every durable detail change; messages have their own sequence. */
  revision: number;
  channel: Channel;
  lead: ChannelLead;
  members: ChannelMember[];
  messages: ChannelMessage[];
  /** The newest unanswered public request, including one outside the message window. */
  request: ChannelConversationMessage | null;
  /** Oldest first. */
  artifacts: ChannelArtifact[];
  /** Oldest first. */
  routines: ChannelRoutine[];
  presence: Record<string, ChannelAgentPresence>;
};

export type ChannelEvent<A = ChannelAttachment> = (
  | {
      type: "message";
      message: ChannelMessage<A>;
    }
  | {
      type: "reaction";
      sequence: number;
      agentId: string;
      reaction: ChannelReaction["reaction"] | null;
    }
  | { type: "tasks"; tasks: ChannelTask[] }
  | { type: "model"; model: ModelConfiguration; updatedAt: string }
  | { type: "read"; seenThrough: number }
  | { type: "member"; member: ChannelMember }
  | { type: "status"; agentId: string; status?: ChannelAgent["status"] }
) & { revision: number };

/** Cached clients replay ordered details; only a new client or expired cursor needs a snapshot. */
export type ChannelObservationEvent =
  | { type: "snapshot"; state: ChannelState }
  | { type: "resumed"; presence: Record<string, ChannelAgentPresence> }
  | { type: "presence"; presence: Record<string, ChannelAgentPresence> }
  | ChannelEvent
  | { type: "deleted"; channelId: string };

export const createChannelInputSchema = z
  .object({
    name: channelNameSchema,
    purpose: channelPurposeSchema
      .optional()
      .describe("What the channel is for. Omit it to let the lead ask the user."),
    directory: channelDirectorySchema.optional(),
    model: modelConfigurationSchema,
  })
  .strict();

export const channelIdentitySchema = z.object({ channelId: durableIdSchema }).strict();

export const removeChannelMemberInputSchema = z.object({ agentId: durableIdSchema }).strict();

const channelChangesSchema = z
  .object({
    model: modelConfigurationSchema.optional(),
    name: channelNameSchema.optional().describe("The channel's new title."),
    purpose: channelPurposeSchema
      .nullable()
      .optional()
      .describe("What the channel is currently for, or null to clear it."),
    directory: channelDirectorySchema
      .nullable()
      .optional()
      .describe(
        "The working directory for all channel agents on their next execution, or null to clear it.",
      ),
    tasks: z
      .array(channelTaskSchema)
      .max(50)
      .optional()
      .describe("The complete task list, replacing the previous tasks."),
    previewUrl: channelPreviewUrlSchema
      .nullable()
      .optional()
      .describe("The current runnable preview URL, or null to clear it."),
  })
  .strict();
export type ChannelChanges = z.output<typeof channelChangesSchema>;
export type ChannelMessageActor = z.output<typeof channelMessageActorSchema>;

export const editChannelInputSchema = channelChangesSchema
  .pick({ name: true, purpose: true, model: true })
  .extend(channelIdentitySchema.shape)
  .refine(({ channelId: _channelId, ...changes }) => hasChanges(changes), {
    message: "Change the channel name, purpose, or lead model.",
  });

export const updateChannelInputSchema = channelChangesSchema
  .omit({ model: true })
  .refine(hasChanges, {
    message: "Update the name, purpose, directory, tasks, preview URL, or any combination of them.",
  });

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
export type EditChannelInput = z.output<typeof editChannelInputSchema>;
export type PostChannelMessageInput = z.output<typeof postChannelMessageInputSchema>;
export type UpdateChannelInput = z.output<typeof updateChannelInputSchema>;

export function unassignChannelTasks(
  tasks: readonly ChannelTask[],
  agentId: string,
): ChannelTask[] {
  return tasks.map(({ ownerId, children, ...task }) => ({
    ...task,
    ...(ownerId && ownerId !== agentId ? { ownerId } : {}),
    ...(children ? { children: unassignChannelTasks(children, agentId) } : {}),
  }));
}

export function channelHasUnread(channel: Channel): boolean {
  return channel.latestSequence > channel.seenThrough;
}

/** A task list is complete when it has tasks and every task and subtask is done. */
export function channelTasksComplete(tasks: readonly ChannelTask[]): boolean {
  const allDone = (tasks: readonly ChannelTask[]): boolean =>
    tasks.every(({ status, children = [] }) => status === "done" && allDone(children));
  return tasks.length > 0 && allDone(tasks);
}

/** Complete delivery policy for user, lead, and member messages. */
export function resolveChannelAudience({
  content,
  sender,
  lead,
  members,
  acknowledgedRequest = false,
}: {
  content: string;
  sender: ChannelMessageActor;
  lead: ChannelAgent;
  members: readonly ChannelAgent[];
  /** Persistence established that this user reply acknowledged a pending request. */
  acknowledgedRequest?: boolean;
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
  return agents.filter(
    ({ id }) =>
      id !== senderId &&
      (mentionAll || mentionedIds.has(id) || (acknowledgedRequest && id === lead.id)),
  );
}

/** An audience by name, or "Everyone" when it's every agent the sender could reach. */
export function channelAudienceLabel(
  audience: readonly ChannelAgent[],
  reachableCount: number,
): string {
  return audience.length > 1 && audience.length === reachableCount
    ? "Everyone"
    : audience.map(({ name }) => name).join(", ");
}
