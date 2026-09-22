import { defineTool, type ToolResult } from "@sessions/server/tools/definition";
import { z } from "zod";
import {
  agentHandleFromName,
  channelIdentitySchema,
  channelMessageContentSchema,
  channelReactionKindSchema,
  createChannelMemberInputSchema,
  createChannelInputSchema,
  isChannelSystemMessage,
  selfUpdateAgentInputSchema,
  setChannelStatusInputSchema,
  updateChannelInputSchema,
  type Channel,
  type ChannelMessage,
} from "@channels/model";
import { resolveWorkspaceFile } from "@files/server/paths";
import type { Attachment } from "@sessions/model";

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
    return JSON.stringify({ channels: (await listChannels()).channels.map(channelForTool) });
  },
});

const createChannelTool = defineTool("create_channel", {
  description:
    "Creates a channel with an intrinsic lead. With a purpose, the lead starts working toward it immediately. Without one, the lead asks the user what they want to work on. The model configures the lead. The optional working directory is created when needed.",
  parameters: createChannelInputSchema,
  handler: async (input) => {
    const { createChannel } = await import("@channels/server");
    return JSON.stringify({ channel: channelForTool(await createChannel(input)) });
  },
});

export const createChannelMembersTool = defineTool("create_channel_members", {
  description:
    "Creates one or more members in a channel with unique names, optional roles, and optional models. A role defines the member's responsibility in the channel plus any necessary persona or behavioral details. Use list_models to resolve supported model options. Mention the returned handles in a channel message to wake the members. Members without a role or avatar establish them during their first turn.",
  parameters: channelIdentitySchema.extend({ members: channelMemberCreationsSchema }),
  handler: async ({ channelId, members }) => {
    const { createChannelMembers } = await import("@channels/server");
    return createdChannelMembers(await createChannelMembers(channelId, members));
  },
});

const createCurrentChannelMembersTool = defineTool("create_channel_members", {
  description:
    "Creates one or more members in this channel with unique names, optional roles, and optional models. A role defines the member's responsibility in the channel plus any necessary persona or behavioral details. Use list_models to resolve supported model options. Mention the returned handles in a channel message to wake the members. Members without a role or avatar establish them during their first turn.",
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
    return JSON.stringify({ sequence: message.sequence });
  },
});

const readChannelForSessionTool = defineTool("read_channel", {
  description:
    "Reads the channel purpose, public checklist, preview URL, lead, current members, shared artifacts, attachments, and newest 100 messages before an optional sequence without changing read state. Omit beforeSequence for the latest messages. While hasMore is true, continue with the first returned message's sequence. File attachments are absolute paths. Inline uploads are attached images.",
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
    return JSON.stringify({
      agents: await waitForChannelAgents(channelId, agentIds, timeoutMs),
    });
  },
});

const readChannelForAgentTool = defineTool("read_channel", {
  description:
    "Reads the channel purpose, public checklist, preview URL, lead, current members, shared artifacts, attachments, and this agent's next 100 unread messages, then advances its read position. Repeat while hasMore is true. File attachments are absolute paths. Inline uploads are attached images.",
  parameters: z.object({}),
  handler: async (_args, invocation) => {
    const { readChannelForAgent } = await import("@channels/server");
    return toChannelReadToolResult(await readChannelForAgent(invocation.sessionId));
  },
});

const sendChannelMessageTool = defineTool("send_channel_message", {
  description:
    "Publishes a Markdown channel message without ending the turn. Pass screenshot and image paths in attachments. Name-derived @mentions wake the addressed agents. @everyone wakes the lead and all members. Without mentions, member messages wake the lead and lead messages wake nobody.",
  parameters: z.object({
    content: conciseChannelMessageSchema,
    attachments: z.array(filePathSchema).optional(),
  }),
  handler: async (args, invocation) => {
    const { sendChannelMessageFromAgent } = await import("@channels/server");
    const message = await sendChannelMessageFromAgent(invocation.sessionId, {
      content: args.content,
      attachmentPaths: args.attachments,
    });
    return JSON.stringify({ sequence: message.sequence });
  },
});

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
    return JSON.stringify({ reaction });
  },
});

const setChannelStatusTool = defineTool("set_channel_status", {
  description:
    "Sets this agent's brief channel status without posting a message, waking agents, or ending the turn.",
  parameters: setChannelStatusInputSchema,
  handler: async (args, invocation) => {
    const { setChannelAgentStatus } = await import("@channels/server");
    return JSON.stringify({
      status: await setChannelAgentStatus(invocation.sessionId, args),
    });
  },
});

const updateChannelTool = defineTool("update_channel", {
  description:
    "Updates this channel's purpose, public checklist, or preview URL. Set the purpose when the user defines or revises what the channel is for. Replace the complete checklist when progress changes. Preserve root-relative preview URLs returned by Toy Box tools. Share file artifacts instead of using them as previews. Set purpose or previewUrl to null to clear it.",
  parameters: updateChannelInputSchema,
  handler: async (args, invocation) => {
    const { updateChannelFromLead } = await import("@channels/server");
    return JSON.stringify(await updateChannelFromLead(invocation.sessionId, args));
  },
});

const finishChannelAgentTurnTool = defineTool("finish_agent_turn", {
  description:
    "Ends this private agent turn and clears its active channel status. waitingFor leaves a brief waiting status.",
  parameters: z
    .object({
      waitingFor: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .optional()
        .describe("What this agent is waiting for after the turn ends."),
    })
    .strict(),
  isTerminal: true,
  handler: async ({ waitingFor }, invocation) => {
    const { finishChannelAgentTurn } = await import("@channels/server");
    await finishChannelAgentTurn(invocation.sessionId, waitingFor);
    return "Done.";
  },
});

const updateAgentTool = defineTool("update_agent", {
  description: "Updates this channel agent's role, avatar, or both.",
  parameters: selfUpdateAgentInputSchema,
  handler: async (args, invocation) => {
    const { updateCurrentChannelAgent } = await import("@channels/server");
    return JSON.stringify(await updateCurrentChannelAgent(invocation.sessionId, args));
  },
});

const shareChannelArtifactFromSessionTool = defineTool("share_channel_artifact", {
  description:
    "Registers an existing standalone file once for the channel to review or evolve without copying it. Later file edits appear automatically, and sharing the same file and title again is a no-op. The path may be absolute or relative to this session's workspace.",
  parameters: channelIdentitySchema.extend(shareChannelArtifactInputSchema.shape),
  handler: async (args, invocation) => {
    const { shareChannelArtifactFromSession } = await import("@channels/server");
    return JSON.stringify(await shareChannelArtifactFromSession(invocation.sessionId, args));
  },
});

const shareChannelArtifactFromAgentTool = defineTool("share_channel_artifact", {
  description:
    "Registers an existing standalone file once for the channel to review or evolve without copying it. Later file edits appear automatically, and sharing the same file and title again is a no-op. The path may be absolute or relative to this agent's workspace.",
  parameters: shareChannelArtifactInputSchema,
  handler: async (args, invocation) => {
    const { shareChannelArtifactFromAgent } = await import("@channels/server");
    return JSON.stringify(await shareChannelArtifactFromAgent(invocation.sessionId, args));
  },
});

function toChannelReadToolResult<T extends { messages: ChannelMessage[] }>(result: T) {
  const images: Attachment[] = [];
  const messages = result.messages.map((message) => {
    if (isChannelSystemMessage(message)) {
      const content = message.content;
      const { id: _id, ...rest } = message;
      return {
        ...rest,
        content:
          content.type === "member_joined" || content.type === "member_left"
            ? { type: content.type, memberId: content.member.id }
            : {
                ...content,
                artifact: {
                  path: resolveWorkspaceFile(content.artifact.file)!,
                  title: content.artifact.title,
                },
              },
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
      { type: "text", text: JSON.stringify({ ...result, messages }) },
      ...images.map(({ base64, mimeType }) => ({
        type: "image" as const,
        data: base64,
        mimeType,
      })),
    ],
  } satisfies ToolResult;
}

function channelForTool({ id: channelId, name, purpose, directory, model, leadId }: Channel) {
  return {
    channelId,
    name,
    ...(purpose ? { purpose } : {}),
    directory,
    model,
    lead: { leadId, mention: "@lead" },
  };
}

function createdChannelMembers(members: { id: string; name: string }[]): string {
  return JSON.stringify({
    members: members.map((member) => ({
      memberId: member.id,
      mention: `@${agentHandleFromName(member.name)}`,
    })),
  });
}

const commonChannelAgentTools = [
  readChannelForAgentTool,
  setChannelStatusTool,
  sendChannelMessageTool,
  reactToChannelMessageTool,
  shareChannelArtifactFromAgentTool,
];

export const channelLeadTools = [
  ...commonChannelAgentTools,
  createCurrentChannelMembersTool,
  updateChannelTool,
  finishChannelAgentTurnTool,
];
export const channelMemberTools = [
  ...commonChannelAgentTools,
  updateAgentTool,
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
