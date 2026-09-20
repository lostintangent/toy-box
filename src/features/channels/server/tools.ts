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
  type Channel,
  type ChannelMessage,
} from "@channels/model";
import { resolveWorkspaceFile } from "@files/server/paths";
import type { Attachment } from "@sessions/model";

const filePathSchema = z.string().trim().min(1).max(4_096);
const memberIdSchema = z.string().trim().min(1).max(255);
const channelMemberCreationSchema = createChannelMemberInputSchema.omit({ channelId: true });
const channelMemberCreationsSchema = z.array(channelMemberCreationSchema).min(1);
const shareChannelArtifactInputSchema = z
  .object({
    path: filePathSchema,
    title: z.string().trim().min(1).max(160),
  })
  .strict();

const listChannelsTool = defineTool("list_channels", {
  description: "Lists channels with their stable IDs, titles, and working directories.",
  parameters: z.object({}).strict(),
  handler: async () => {
    const { listChannels } = await import("@channels/server");
    return JSON.stringify({ channels: (await listChannels()).channels.map(channelForTool) });
  },
});

const createChannelTool = defineTool("create_channel", {
  description:
    "Creates a channel with a title and optional working directory, creating the directory when needed.",
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
    const { createChannelMembersFromAgent } = await import("@channels/server");
    return createdChannelMembers(
      await createChannelMembersFromAgent(invocation.sessionId, members),
    );
  },
});

const postChannelMessageTool = defineTool("post_channel_message", {
  description:
    "Posts a user-attributed Markdown message with optional image paths to a channel. Relative paths use this session's workspace. Name-derived @mentions wake agents. A message without mentions wakes all current members. Read the channel for exact mentions.",
  parameters: channelIdentitySchema.extend({
    content: channelMessageContentSchema,
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
    "Reads the newest 100 channel messages before an optional sequence without changing read state. Omit beforeSequence for the latest messages. While hasMore is true, continue with the first returned message's sequence. It also returns current members, shared artifacts, and attachments. File attachments are absolute paths. Inline uploads are attached images.",
  parameters: channelIdentitySchema.extend({
    beforeSequence: z.number().int().positive().optional(),
  }),
  handler: async ({ channelId, beforeSequence }) => {
    const { readChannelForSession } = await import("@channels/server");
    return toChannelReadToolResult(await readChannelForSession(channelId, beforeSequence));
  },
});

const waitForChannelMembersTool = defineTool("wait_for_channel_members", {
  description:
    "Waits for one or more channel members' current executions to complete. Use after posting a message that wakes them, then read the channel for their public responses. Timing out does not stop their executions.",
  parameters: channelIdentitySchema.extend({
    memberIds: z.array(memberIdSchema).min(1).describe("One or more member IDs to wait for"),
    timeoutMs: z
      .number()
      .int()
      .nonnegative()
      .max(300000)
      .optional()
      .describe("Optional maximum time to wait in milliseconds"),
  }),
  handler: async ({ channelId, memberIds, timeoutMs }) => {
    const { waitForChannelMembers } = await import("@channels/server");
    return JSON.stringify({
      members: await waitForChannelMembers(channelId, memberIds, timeoutMs),
    });
  },
});

const readChannelForAgentTool = defineTool("read_channel", {
  description:
    "Reads this agent's next 100 unread channel messages and attachments, then advances its read position. Repeat while hasMore is true. It also returns current members with exact mentions and statuses, plus shared artifacts. File attachments are absolute paths. Inline uploads are attached images.",
  parameters: z.object({}),
  handler: async (_args, invocation) => {
    const { readChannelForAgent } = await import("@channels/server");
    return toChannelReadToolResult(await readChannelForAgent(invocation.sessionId));
  },
});

const sendChannelMessageTool = defineTool("send_channel_message", {
  description:
    "Publishes a Markdown channel message without ending the turn. Pass screenshot and image paths in attachments. Name-derived @mentions wake agents. @everyone wakes all current members. Messages without mentions wake nobody.",
  parameters: z.object({
    content: channelMessageContentSchema,
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
    "Shares an existing durable document or prototype for the channel to review or evolve without copying or modifying it. Screenshots and image evidence belong in post_channel_message attachments. The path may be absolute or relative to this session's workspace.",
  parameters: channelIdentitySchema.extend(shareChannelArtifactInputSchema.shape),
  handler: async (args, invocation) => {
    const { shareChannelArtifactFromSession } = await import("@channels/server");
    return JSON.stringify(await shareChannelArtifactFromSession(invocation.sessionId, args));
  },
});

const shareChannelArtifactFromAgentTool = defineTool("share_channel_artifact", {
  description:
    "Shares an existing file as a channel artifact without copying or modifying it. The path may be absolute or relative to this agent's workspace.",
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

function channelForTool({ id: channelId, title, directory }: Channel) {
  return { channelId, title, directory };
}

function createdChannelMembers(members: { id: string; name: string }[]): string {
  return JSON.stringify({
    members: members.map((member) => ({
      memberId: member.id,
      mention: `@${agentHandleFromName(member.name)}`,
    })),
  });
}

export const channelAgentTools = [
  readChannelForAgentTool,
  createCurrentChannelMembersTool,
  setChannelStatusTool,
  sendChannelMessageTool,
  reactToChannelMessageTool,
  shareChannelArtifactFromAgentTool,
  updateAgentTool,
  finishChannelAgentTurnTool,
];

export const channelTools = [
  listChannelsTool,
  createChannelTool,
  readChannelForSessionTool,
  postChannelMessageTool,
  waitForChannelMembersTool,
  shareChannelArtifactFromSessionTool,
];
