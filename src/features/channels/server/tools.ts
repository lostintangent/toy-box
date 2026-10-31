import { defineTool, type ToolResult } from "@sessions/server/tools/definition";
import { z } from "zod";
import {
  agentHandleFromName,
  channelAgentIdentity,
  channelTaskElapsedMinutes,
  channelIdentitySchema,
  channelMessageContentSchema,
  channelPathSchema,
  channelReactionKindSchema,
  createChannelMemberInputSchema,
  createChannelInputSchema,
  editChannelTasksInputSchema,
  durableIdSchema,
  isChannelSystemMessage,
  channelRoutineIdentitySchema,
  selfUpdateChannelMemberInputSchema,
  setChannelAgentStatusInputSchema,
  setChannelRoutineInputSchema,
  updateChannelInputSchema,
  type Channel,
  type ChannelAgent,
  type ChannelAgentIdentity,
  type ChannelArtifact,
  type ChannelTask,
} from "@channels/model";
import { workspaceFileId } from "@files/model";
import { resolveWorkspaceFile } from "@files/server/paths";
import type { Attachment } from "@/shared/attachments/model";
import { channelAgentPresence } from "@channels/model/presence";
import { getSessionActivity } from "@sessions/server/state/activity";

const conciseChannelMessageSchema = channelMessageContentSchema.max(
  3_000,
  "Channel messages must be at most 3,000 characters. Put durable long-form work in a shared artifact and send a concise summary. Do not split a document across messages.",
);
const channelMemberCreationSchema = createChannelMemberInputSchema.omit({ channelId: true });
const channelMemberCreationsSchema = z.array(channelMemberCreationSchema).min(1);
const shareChannelArtifactInputSchema = z
  .object({
    path: channelPathSchema,
    title: z.string().trim().min(1).max(160),
  })
  .strict();

const listChannelsTool = defineTool("list_channels", {
  description:
    "Lists channels with their stable IDs, names, purposes, lead models, and working directories.",
  parameters: z.object({}).strict(),
  handler: async () => {
    const { listChannels } = await import("@channels/server");
    return { channels: (await listChannels()).channels.map(channelForTool) };
  },
});

const createChannelTool = defineTool("create_channel", {
  description:
    "Creates a channel with an intrinsic lead. With a purpose, the lead starts working toward it immediately. Without one, the lead asks the user what they want to work on. The model configures the lead. The working directory is optional.",
  parameters: createChannelInputSchema,
  handler: async (input) => {
    const { createChannel } = await import("@channels/server");
    return { channel: channelForTool(await createChannel(input)) };
  },
});

export const createChannelMembersTool = defineTool("create_channel_members", {
  description:
    "Creates one or more members in a channel with unique names, optional roles, and optional models. A role defines the member's responsibility in the channel plus any necessary persona or behavioral details. Use list_models to resolve supported model options. Members begin onboarding immediately. Mention the returned handles in a channel message to assign work.",
  parameters: channelIdentitySchema.extend({ members: channelMemberCreationsSchema }),
  handler: async ({ channelId, members }) => {
    const { createChannelMembers } = await import("@channels/server");
    return createdChannelMembers(await createChannelMembers(channelId, members));
  },
});

const createCurrentChannelMembersTool = defineTool("create_channel_members", {
  description:
    "Creates one or more members in this channel with unique names, optional roles, and optional models. A role defines the member's responsibility in the channel plus any necessary persona or behavioral details. Use list_models to resolve supported model options. Members begin onboarding immediately. Mention the returned handles in a channel message to assign work.",
  parameters: z.object({ members: channelMemberCreationsSchema }).strict(),
  handler: async ({ members }, sessionId) => {
    const { createChannelMembersFromLead } = await import("@channels/server");
    return createdChannelMembers(await createChannelMembersFromLead(sessionId, members));
  },
});

const postChannelMessageTool = defineTool("post_channel_message", {
  description:
    "Posts a user-attributed Markdown message with optional image or video paths to a channel. Relative paths use this session's workspace. Name-derived @mentions wake the addressed agents. A message without mentions wakes the lead. Read the channel for exact mentions.",
  parameters: channelIdentitySchema.extend({
    content: conciseChannelMessageSchema,
    attachments: z.array(channelPathSchema).optional(),
  }),
  handler: async ({ attachments, ...input }, sessionId) => {
    const { postChannelMessageFromSession } = await import("@channels/server");
    const message = await postChannelMessageFromSession(sessionId, {
      id: crypto.randomUUID(),
      ...input,
      attachmentPaths: attachments,
    });
    return { sequence: message.sequence };
  },
});

const readChannelForSessionTool = defineTool("read_channel", {
  description:
    "Reads the channel purpose, tasks, URL or screen preview, lead, current members, shared artifacts, routines, attachments, and newest 100 messages before an optional sequence without changing read state. Omit beforeSequence for the latest messages. While hasMore is true, continue with the first returned message's sequence. File attachments are absolute paths. Inline uploads are attached images.",
  parameters: channelIdentitySchema.extend({
    beforeSequence: z.number().int().positive().optional(),
  }),
  handler: async ({ channelId, beforeSequence }) => {
    const { readChannelForSession } = await import("@channels/server");
    return toChannelReadToolResult(await readChannelForSession(channelId, beforeSequence));
  },
});

const waitForChannelAgentsTool = defineTool("wait_for_channel_agents", {
  description:
    "Waits for the channel lead or one or more members to finish their current executions. Use after creating a channel or posting a message that wakes them, then read the channel for their public responses. Timing out does not stop their executions.",
  parameters: channelIdentitySchema.extend({
    agentIds: z
      .array(durableIdSchema)
      .min(1)
      .describe("The lead ID or one or more member IDs to wait for"),
    timeoutMs: z
      .number()
      .int()
      .nonnegative()
      .max(300000)
      .optional()
      .describe("Optional maximum time to wait in milliseconds"),
  }),
  handler: async ({ channelId, agentIds, timeoutMs }) => {
    const { waitForChannelAgents } = await import("@channels/server");
    return {
      agents: await waitForChannelAgents(channelId, agentIds, timeoutMs),
    };
  },
});

const readChannelForAgentTool = defineTool("read_channel", {
  description:
    "Reads this agent's next 100 unread messages, unfinished assigned tasks (all unfinished tasks for the lead), and working or waiting agents. Advances its read position. With no read cursor, always returns full context. Set detail:'full' for the channel purpose, directory, preview, complete tasks, roster with roles, artifacts, and routines. Repeat while hasMore is true. File attachments are absolute paths. Inline uploads are attached images.",
  parameters: z.object({ detail: z.enum(["compact", "full"]).optional() }),
  handler: async ({ detail }, sessionId) => {
    const { readChannelForAgent } = await import("@channels/server");
    const result = await readChannelForAgent(sessionId);
    return toChannelReadToolResult(
      result,
      detail === "full" || result.isInitialRead ? undefined : sessionId,
    );
  },
});

const sendChannelMessageParameters = z.object({
  content: conciseChannelMessageSchema,
  attachments: z.array(channelPathSchema).optional(),
});

const sendLeadMessageParameters = sendChannelMessageParameters.extend({
  request: z
    .boolean()
    .optional()
    .describe(
      "Flags this message as needing the user's decision, context, or action until the user next posts.",
    ),
});

const sendChannelMessageTool = defineTool("send_channel_message", {
  description:
    "Publishes a Markdown channel message without ending the turn. Pass screenshot, image, and video paths in attachments. Name-derived @mentions wake the addressed agents. @everyone wakes the lead and all members. Without mentions, member messages wake the lead and lead messages wake nobody.",
  parameters: sendChannelMessageParameters,
  handler: async (args: z.output<typeof sendLeadMessageParameters>, sessionId) => {
    const { sendChannelMessageFromAgent } = await import("@channels/server");
    const message = await sendChannelMessageFromAgent(sessionId, {
      content: args.content,
      attachmentPaths: args.attachments,
      request: args.request,
    });
    return { sequence: message.sequence };
  },
});

/** The same tool plus an input request, which only the lead can make. */
const sendLeadMessageTool = { ...sendChannelMessageTool, parameters: sendLeadMessageParameters };

const reactToChannelMessageTool = defineTool("react_to_channel_message", {
  description:
    "Sets or clears this agent's durable reaction on a user or agent message. Does not wake agents or end the turn.",
  parameters: z.object({
    sequence: z.number().int().positive(),
    reaction: channelReactionKindSchema.nullable(),
  }),
  handler: async (args, sessionId) => {
    const { setChannelMessageReactionFromAgent } = await import("@channels/server");
    const reaction = await setChannelMessageReactionFromAgent(sessionId, args);
    return { reaction };
  },
});

const setChannelStatusTool = defineTool("set_agent_status", {
  description:
    "Sets this agent's brief channel status without posting a message, waking agents, or ending the turn.",
  parameters: setChannelAgentStatusInputSchema,
  handler: async (args, sessionId) => {
    const { setChannelAgentStatus } = await import("@channels/server");
    return {
      status: await setChannelAgentStatus(sessionId, args),
    };
  },
});

const updateChannelTool = defineTool("update_channel", {
  description:
    "Updates this channel's name, purpose, working directory, tasks, or preview. Only the lead can update it. Use an existing absolute directory, which applies to all agents at their next execution. Supply tasks only for initial planning or intentional whole-list replacement after read_channel with detail:'full'; never replace the tree from unfinishedTasks. Use edit_channel_tasks for progress updates. Set preview to {kind:'url',url} or {kind:'screen',screenId} from list_screens. A screen reference opens an existing host display or window; it does not launch an app. Preserve root-relative preview URLs. Share file artifacts instead of using them as previews. Set purpose, directory, or preview to null to clear it.",
  parameters: updateChannelInputSchema,
  handler: async (args, sessionId) => {
    const { updateChannelFromLead } = await import("@channels/server");
    return channelContextForTool(await updateChannelFromLead(sessionId, args));
  },
});

const editChannelTasksTool = defineTool("edit_channel_tasks", {
  description:
    "Adds, updates, removes, or moves this channel's tasks by stable ID in one atomic batch. Returns targeted task IDs without repeating the tree.",
  parameters: editChannelTasksInputSchema,
  handler: async (input, sessionId) => {
    const { editChannelTasksFromLead } = await import("@channels/server");
    await editChannelTasksFromLead(sessionId, input);
    return {
      taskIds: [
        ...new Set(
          input.operations.map((operation) =>
            operation.type === "add" ? operation.task.id : operation.taskId,
          ),
        ),
      ],
    };
  },
});

const FOLLOW_UP_BOUNDS =
  "Follow-ups check on a teammate or external work within two hours. Use a routine for anything later or recurring.";

const finishChannelAgentTurnParameters = z
  .object({
    waitingFor: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe("What this agent is waiting for after the turn ends."),
    wakeAfterMinutes: z
      .number()
      .int()
      .min(5, FOLLOW_UP_BOUNDS)
      .max(120, FOLLOW_UP_BOUNDS)
      .optional()
      .describe(
        "Wake after this many minutes to check on what you're waiting for, unless something wakes you first.",
      ),
  })
  .strict()
  .refine(
    ({ waitingFor, wakeAfterMinutes }) =>
      wakeAfterMinutes === undefined || waitingFor !== undefined,
    "Pass waitingFor with wakeAfterMinutes.",
  );

const finishChannelAgentTurnTool = defineTool("finish_agent_turn", {
  description:
    "Ends this private agent turn and clears its active channel status. waitingFor leaves a brief waiting status. Add wakeAfterMinutes to check back unless something wakes you first.",
  parameters: finishChannelAgentTurnParameters,
  // TODO: Restore isTerminal after https://github.com/github/copilot-cli/issues/4755 is fixed.
  handler: async ({ waitingFor, wakeAfterMinutes }, sessionId) => {
    const { finishChannelAgentTurn } = await import("@channels/server");
    await finishChannelAgentTurn(sessionId, waitingFor, wakeAfterMinutes);
    return "Done.";
  },
});

const setRoutineTool = defineTool("set_routine", {
  description:
    "Adds a routine that privately wakes you with its prompt on its schedule, or changes one by routineId. Posts a system message to the channel.",
  parameters: setChannelRoutineInputSchema,
  handler: async (input, sessionId) => {
    const { setChannelRoutineFromLead } = await import("@channels/server");
    const routine = await setChannelRoutineFromLead(sessionId, input);
    return { routineId: routine.id };
  },
});

const deleteRoutineTool = defineTool("delete_routine", {
  description: "Deletes one of this channel's routines and posts a system message.",
  parameters: channelRoutineIdentitySchema.omit({ channelId: true }),
  handler: async ({ routineId }, sessionId) => {
    const { deleteChannelRoutine } = await import("@channels/server");
    // A lead's session ID is its Channel's ID.
    if (!(await deleteChannelRoutine(sessionId, routineId))) {
      throw new Error("Routine not found in this channel.");
    }
    return "Removed.";
  },
});

const updateMemberTool = defineTool("update_member", {
  description: "Updates this channel agent's role, avatar, or both.",
  parameters: selfUpdateChannelMemberInputSchema,
  handler: async (args, sessionId) => {
    const { updateChannelMember } = await import("@channels/server");
    const { id: agentId, ...member } = await updateChannelMember({
      agentId: sessionId,
      ...args,
    });
    return { agentId, ...member };
  },
});

const shareChannelArtifactFromSessionTool = defineTool("share_channel_artifact", {
  description:
    "Registers an existing standalone file once for the channel to review or evolve without copying it. Later file edits appear automatically, and sharing the same file and title again is a no-op. The path may be absolute or relative to this session's workspace.",
  parameters: channelIdentitySchema.extend(shareChannelArtifactInputSchema.shape),
  handler: async (args, sessionId) => {
    const { shareChannelArtifactFromSession } = await import("@channels/server");
    return artifactForTool(await shareChannelArtifactFromSession(sessionId, args));
  },
});

const shareChannelArtifactFromAgentTool = defineTool("share_channel_artifact", {
  description:
    "Registers an existing standalone file once for the channel to review or evolve without copying it. Later file edits appear automatically, and sharing the same file and title again is a no-op. The path may be absolute or relative to this agent's workspace.",
  parameters: shareChannelArtifactInputSchema,
  handler: async (args, sessionId) => {
    const { shareChannelArtifactFromAgent } = await import("@channels/server");
    return artifactForTool(await shareChannelArtifactFromAgent(sessionId, args));
  },
});

function toChannelReadToolResult(
  result: Awaited<ReturnType<typeof import(".").readChannelForSession>>,
  compactForAgentId?: string,
) {
  const agents = [result.lead, ...result.members];
  const images: Attachment[] = [];
  const messages = result.messages.map((message) => {
    const sender =
      compactForAgentId && message.sender.type === "agent"
        ? {
            type: "agent" as const,
            ...agentIdentityForTool(channelAgentIdentity(agents, message.sender.agentId)),
          }
        : message.sender;
    if (isChannelSystemMessage(message)) {
      const content = message.content;
      const { id: _id, ...rest } = message;
      return {
        ...rest,
        sender,
        content:
          content.type === "member_joined" || content.type === "member_left"
            ? {
                type: content.type,
                ...(compactForAgentId
                  ? agentIdentityForTool(content.member)
                  : { agentId: content.member.id }),
              }
            : content.type === "artifact_shared"
              ? {
                  ...content,
                  artifact: artifactForTool(content.artifact),
                }
              : content,
      };
    }
    const { id: _id, attachments, ...rest } = message;
    return {
      ...rest,
      sender,
      ...(attachments?.length
        ? {
            attachments: attachments.map((attachment) => {
              if (typeof attachment === "string") return attachment;
              return {
                mimeType: attachment.mimeType,
                imageIndex: images.push(attachment) - 1,
              };
            }),
          }
        : {}),
    };
  });
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ...(compactForAgentId
            ? {
                unfinishedTasks: unfinishedTasksForTool(
                  result.channel.tasks,
                  compactForAgentId === result.lead.id ? undefined : compactForAgentId,
                  Date.now(),
                ),
                agents: agents
                  .map(agentForTool)
                  .filter((agent) => agent.status)
                  .map(({ role: _role, ...agent }) => agent),
              }
            : {
                channel: channelContextForTool(result.channel),
                lead: agentForTool(result.lead),
                members: result.members.map(agentForTool),
                artifacts: result.artifacts.map(artifactForTool),
                routines: result.routines.map(({ id, ...routine }) => ({
                  routineId: id,
                  ...routine,
                })),
              }),
          messages,
          hasMore: result.hasMore,
        }),
      },
      ...images.map(({ base64, mimeType }) => ({
        type: "image" as const,
        data: base64,
        mimeType,
      })),
    ],
  } satisfies ToolResult;
}

function channelContextForTool({ name, purpose, directory, tasks, preview }: Channel) {
  return { name, purpose, directory, tasks, preview };
}

type UnfinishedTask = Omit<ChannelTask, "children" | "startedAt"> & {
  elapsedMinutes?: number;
  children?: UnfinishedTask[];
};

function unfinishedTasksForTool(
  tasks: readonly ChannelTask[],
  ownerId: string | undefined,
  now: number,
): UnfinishedTask[] {
  return tasks.flatMap(({ children, startedAt, ...task }) => {
    const unfinishedChildren = unfinishedTasksForTool(children ?? [], ownerId, now);
    if (
      !unfinishedChildren.length &&
      (task.status === "done" || (ownerId !== undefined && task.ownerId !== ownerId))
    ) {
      return [];
    }
    return [
      {
        ...task,
        elapsedMinutes: channelTaskElapsedMinutes({ startedAt }, now),
        ...(unfinishedChildren.length ? { children: unfinishedChildren } : {}),
      },
    ];
  });
}

function agentIdentityForTool(agent: ChannelAgentIdentity) {
  return {
    agentId: agent.id,
    name: agent.name,
    ...(!agent.deleted ? { mention: `@${agentHandleFromName(agent.name)}` } : {}),
  };
}

function agentForTool(agent: ChannelAgent) {
  const presence = channelAgentPresence(agent, getSessionActivity(agent.id)?.status === "running");
  return {
    ...agentIdentityForTool(agent),
    role: agent.role,
    ...(presence.state !== "idle"
      ? { status: { ...(agent.status?.state === presence.state ? agent.status : {}), ...presence } }
      : {}),
  };
}

function artifactForTool({ file, title }: Pick<ChannelArtifact, "file" | "title">) {
  return { artifactId: workspaceFileId(file), path: resolveWorkspaceFile(file)!, title };
}

function channelForTool({ id: channelId, name, purpose, directory, model }: Channel) {
  return {
    channelId,
    name,
    ...(purpose ? { purpose } : {}),
    directory,
    model,
    lead: { agentId: channelId, mention: "@lead" },
  };
}

function createdChannelMembers(members: { id: string; name: string }[]) {
  return {
    members: members.map((member) => ({
      agentId: member.id,
      mention: `@${agentHandleFromName(member.name)}`,
    })),
  };
}

const commonChannelAgentTools = [
  readChannelForAgentTool,
  setChannelStatusTool,
  reactToChannelMessageTool,
  shareChannelArtifactFromAgentTool,
  finishChannelAgentTurnTool,
];

export const channelLeadTools = [
  ...commonChannelAgentTools,
  sendLeadMessageTool,
  createCurrentChannelMembersTool,
  updateChannelTool,
  editChannelTasksTool,
  setRoutineTool,
  deleteRoutineTool,
];
export const channelMemberTools = [
  ...commonChannelAgentTools,
  sendChannelMessageTool,
  updateMemberTool,
];

export const channelTools = [
  listChannelsTool,
  createChannelTool,
  readChannelForSessionTool,
  postChannelMessageTool,
  waitForChannelAgentsTool,
  shareChannelArtifactFromSessionTool,
];
