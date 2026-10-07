import { defineTool, type ToolResult } from "@sessions/server/tools/definition";
import { z } from "zod";
import {
  agentHandleFromName,
  channelIdentitySchema,
  channelMessageContentSchema,
  channelReactionKindSchema,
  createChannelMemberInputSchema,
  createChannelInputSchema,
  editChannelTasksInputSchema,
  isChannelSystemMessage,
  channelRoutineIdentitySchema,
  selfUpdateChannelMemberInputSchema,
  setChannelAgentStatusInputSchema,
  setChannelRoutineInputSchema,
  updateChannelInputSchema,
  type Channel,
  type ChannelAgent,
  type ChannelArtifact,
} from "@channels/model";
import { workspaceFileId } from "@files/model";
import { resolveWorkspaceFile } from "@files/server/paths";
import type { Attachment } from "@/shared/attachments/model";
import { channelAgentPresence } from "@channels/model/presence";
import { getSessionState } from "@workspace/server/state/sessions";

const filePathSchema = z.string().trim().min(1).max(4_096);
const agentIdSchema = z.string().trim().min(1).max(255);
const conciseChannelMessageSchema = channelMessageContentSchema.max(
  3_000,
  "Channel messages must be at most 3,000 characters. Put durable long-form work in a shared artifact and send a concise summary. Do not split a document across messages.",
);
const channelMemberCreationSchema = createChannelMemberInputSchema.omit({ channelId: true });
const channelMemberCreationsSchema = z.array(channelMemberCreationSchema).min(1);
const shareChannelArtifactInputSchema = z
  .object({
    path: filePathSchema,
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
  handler: async ({ members }, invocation) => {
    const { createChannelMembersFromLead } = await import("@channels/server");
    return createdChannelMembers(await createChannelMembersFromLead(invocation.sessionId, members));
  },
});

const postChannelMessageTool = defineTool("post_channel_message", {
  description:
    "Posts a user-attributed Markdown message with optional image paths to a channel. Relative paths use this session's workspace. Name-derived @mentions wake the addressed agents. A message without mentions wakes the lead. Read the channel for exact mentions.",
  parameters: channelIdentitySchema.extend({
    content: conciseChannelMessageSchema,
    attachments: z.array(filePathSchema).optional(),
  }),
  handler: async ({ attachments, ...input }, invocation) => {
    const { postChannelMessageFromSession } = await import("@channels/server");
    const message = await postChannelMessageFromSession(invocation.sessionId, {
      id: crypto.randomUUID(),
      ...input,
      attachmentPaths: attachments,
    });
    return { sequence: message.sequence };
  },
});

const readChannelForSessionTool = defineTool("read_channel", {
  description:
    "Reads the channel purpose, tasks, preview URL, lead, current members, shared artifacts, routines, attachments, and newest 100 messages before an optional sequence without changing read state. Omit beforeSequence for the latest messages. While hasMore is true, continue with the first returned message's sequence. File attachments are absolute paths. Inline uploads are attached images.",
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
      .array(agentIdSchema)
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
    "Reads the channel purpose, tasks, preview URL, lead, current members, shared artifacts, routines, attachments, and this agent's next 100 unread messages, then advances its read position. Repeat while hasMore is true. File attachments are absolute paths. Inline uploads are attached images.",
  parameters: z.object({}),
  handler: async (_args, invocation) => {
    const { readChannelForAgent } = await import("@channels/server");
    return toChannelReadToolResult(await readChannelForAgent(invocation.sessionId));
  },
});

const sendChannelMessageParameters = z.object({
  content: conciseChannelMessageSchema,
  attachments: z.array(filePathSchema).optional(),
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
    "Publishes a Markdown channel message without ending the turn. Pass screenshot and image paths in attachments. Name-derived @mentions wake the addressed agents. @everyone wakes the lead and all members. Without mentions, member messages wake the lead and lead messages wake nobody.",
  parameters: sendChannelMessageParameters,
  handler: async (args: z.output<typeof sendLeadMessageParameters>, invocation) => {
    const { sendChannelMessageFromAgent } = await import("@channels/server");
    const message = await sendChannelMessageFromAgent(invocation.sessionId, {
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
  handler: async (args, invocation) => {
    const { setChannelMessageReactionFromAgent } = await import("@channels/server");
    const reaction = await setChannelMessageReactionFromAgent(invocation.sessionId, args);
    return { reaction };
  },
});

const setChannelStatusTool = defineTool("set_agent_status", {
  description:
    "Sets this agent's brief channel status without posting a message, waking agents, or ending the turn.",
  parameters: setChannelAgentStatusInputSchema,
  handler: async (args, invocation) => {
    const { setChannelAgentStatus } = await import("@channels/server");
    return {
      status: await setChannelAgentStatus(invocation.sessionId, args),
    };
  },
});

const updateChannelTool = defineTool("update_channel", {
  description:
    "Updates this channel's name, purpose, working directory, tasks, or preview URL. Only the lead can change its working directory; use an existing absolute path, which applies to all agents at their next execution. Rename it when the user changes its title; set the purpose when the user defines or revises what the channel is for. Supply tasks only for initial planning or intentional whole-list replacement, preserving retained IDs and outcomes. Use edit_channel_tasks for progress updates. Preserve root-relative preview URLs returned by Toy Box tools. Share file artifacts instead of using them as previews. Set purpose, directory, or previewUrl to null to clear it.",
  parameters: updateChannelInputSchema,
  handler: async (args, invocation) => {
    const { updateChannelFromLead } = await import("@channels/server");
    return channelContextForTool(await updateChannelFromLead(invocation.sessionId, args));
  },
});

const editChannelTasksTool = defineTool("edit_channel_tasks", {
  description:
    "Adds, updates, removes, or moves this channel's tasks by stable ID in one atomic batch. Returns targeted task IDs without repeating the tree.",
  parameters: editChannelTasksInputSchema,
  handler: async (input, invocation) => {
    const { editChannelTasksFromLead } = await import("@channels/server");
    await editChannelTasksFromLead(invocation.sessionId, input);
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

const finishChannelAgentTurnParameters = z
  .object({
    waitingFor: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe("What this agent is waiting for after the turn ends."),
  })
  .strict();

const FOLLOW_UP_BOUNDS =
  "Follow-ups check on a member or external work within two hours. Use a routine for anything later or recurring.";

const finishLeadTurnParameters = finishChannelAgentTurnParameters
  .extend({
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
  .refine(
    ({ waitingFor, wakeAfterMinutes }) =>
      wakeAfterMinutes === undefined || waitingFor !== undefined,
    "Pass waitingFor with wakeAfterMinutes.",
  );

const finishChannelAgentTurnTool = defineTool("finish_agent_turn", {
  description:
    "Ends this private agent turn and clears its active channel status. waitingFor leaves a brief waiting status.",
  parameters: finishChannelAgentTurnParameters,
  isTerminal: true,
  handler: async (
    { waitingFor, wakeAfterMinutes }: z.output<typeof finishLeadTurnParameters>,
    invocation,
  ) => {
    const { finishChannelAgentTurn } = await import("@channels/server");
    await finishChannelAgentTurn(invocation.sessionId, waitingFor, wakeAfterMinutes);
    return "Done.";
  },
});

/** The same tool plus a follow-up, which only the lead can set. */
const finishLeadTurnTool = { ...finishChannelAgentTurnTool, parameters: finishLeadTurnParameters };

const setRoutineTool = defineTool("set_routine", {
  description:
    "Adds a routine that privately wakes you with its prompt on its schedule, or changes one by routineId. Posts a system message to the channel.",
  parameters: setChannelRoutineInputSchema,
  handler: async (input, invocation) => {
    const { setChannelRoutineFromLead } = await import("@channels/server");
    const routine = await setChannelRoutineFromLead(invocation.sessionId, input);
    return { routineId: routine.id };
  },
});

const deleteRoutineTool = defineTool("delete_routine", {
  description: "Deletes one of this channel's routines and posts a system message.",
  parameters: channelRoutineIdentitySchema.omit({ channelId: true }),
  handler: async ({ routineId }, invocation) => {
    const { deleteChannelRoutine } = await import("@channels/server");
    // A lead's session ID is its Channel's ID.
    if (!(await deleteChannelRoutine(invocation.sessionId, routineId))) {
      throw new Error("Routine not found in this channel.");
    }
    return "Removed.";
  },
});

const updateMemberTool = defineTool("update_member", {
  description: "Updates this channel agent's role, avatar, or both.",
  parameters: selfUpdateChannelMemberInputSchema,
  handler: async (args, invocation) => {
    const { updateChannelMember } = await import("@channels/server");
    const { id: agentId, ...member } = await updateChannelMember({
      agentId: invocation.sessionId,
      ...args,
    });
    return { agentId, ...member };
  },
});

const shareChannelArtifactFromSessionTool = defineTool("share_channel_artifact", {
  description:
    "Registers an existing standalone file once for the channel to review or evolve without copying it. Later file edits appear automatically, and sharing the same file and title again is a no-op. The path may be absolute or relative to this session's workspace.",
  parameters: channelIdentitySchema.extend(shareChannelArtifactInputSchema.shape),
  handler: async (args, invocation) => {
    const { shareChannelArtifactFromSession } = await import("@channels/server");
    return artifactForTool(await shareChannelArtifactFromSession(invocation.sessionId, args));
  },
});

const shareChannelArtifactFromAgentTool = defineTool("share_channel_artifact", {
  description:
    "Registers an existing standalone file once for the channel to review or evolve without copying it. Later file edits appear automatically, and sharing the same file and title again is a no-op. The path may be absolute or relative to this agent's workspace.",
  parameters: shareChannelArtifactInputSchema,
  handler: async (args, invocation) => {
    const { shareChannelArtifactFromAgent } = await import("@channels/server");
    return artifactForTool(await shareChannelArtifactFromAgent(invocation.sessionId, args));
  },
});

function toChannelReadToolResult(
  result: Awaited<ReturnType<typeof import(".").readChannelForSession>>,
) {
  const images: Attachment[] = [];
  const messages = result.messages.map((message) => {
    if (isChannelSystemMessage(message)) {
      const content = message.content;
      const { id: _id, ...rest } = message;
      return {
        ...rest,
        content:
          content.type === "member_joined" || content.type === "member_left"
            ? { type: content.type, agentId: content.member.id }
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
          channel: channelContextForTool(result.channel),
          lead: agentForTool(result.lead),
          members: result.members.map(agentForTool),
          artifacts: result.artifacts.map(artifactForTool),
          routines: result.routines.map(({ id, ...routine }) => ({ routineId: id, ...routine })),
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

function channelContextForTool({ name, purpose, directory, tasks, previewUrl }: Channel) {
  return { name, purpose, directory, tasks, previewUrl };
}

function agentForTool(agent: ChannelAgent) {
  const presence = channelAgentPresence(agent, getSessionState(agent.id)?.status === "running");
  return {
    agentId: agent.id,
    name: agent.name,
    mention: `@${agentHandleFromName(agent.name)}`,
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
];

export const channelLeadTools = [
  ...commonChannelAgentTools,
  sendLeadMessageTool,
  createCurrentChannelMembersTool,
  updateChannelTool,
  editChannelTasksTool,
  setRoutineTool,
  deleteRoutineTool,
  finishLeadTurnTool,
];
export const channelMemberTools = [
  ...commonChannelAgentTools,
  sendChannelMessageTool,
  updateMemberTool,
  finishChannelAgentTurnTool,
];

export const channelTools = [
  listChannelsTool,
  createChannelTool,
  readChannelForSessionTool,
  postChannelMessageTool,
  waitForChannelAgentsTool,
  shareChannelArtifactFromSessionTool,
];
