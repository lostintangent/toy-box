import { defineTool, type ToolResult } from "@sessions/server/tools/definition";
import { z } from "zod";
import { agentIdSchema, agentMembershipStatusSchema } from "@agents/model";
import { listAgentsTool } from "@agents/server/tools";
import {
  channelIdentitySchema,
  channelMessageContentSchema,
  channelReactionKindSchema,
  createChannelInputSchema,
  isChannelSystemMessage,
  setChannelStatusInputSchema,
  type Channel,
  type ChannelMessage,
} from "@channels/model";
import { resolveWorkspaceFile } from "@files/server/paths";
import type { Attachment } from "@sessions/model";

const filePathSchema = z.string().trim().min(1).max(4_096);
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
  description: "Creates a channel with a title and optional working directory.",
  parameters: createChannelInputSchema,
  handler: async (input) => {
    const { createChannel } = await import("@channels/server");
    return JSON.stringify({ channel: channelForTool(await createChannel(input)) });
  },
});

const postChannelMessageTool = defineTool("post_channel_message", {
  description:
    "Posts a user-attributed Markdown message with optional image paths to a channel. Relative paths use this session's workspace. Name-derived @mentions wake or invite agents. A message without mentions wakes all current members. Use list_channels to discover channel IDs and list_available_agents for exact agent mentions.",
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

const waitForChannelAgentTool = defineTool("wait_for_channel_agent", {
  description:
    "Waits for one channel agent's current execution to complete. Use after posting a message that wakes the agent, then read the channel for its public response. Timing out does not stop the agent.",
  parameters: channelIdentitySchema.extend({
    agentId: agentIdSchema.describe("The agent ID to wait for"),
    timeoutMs: z
      .number()
      .int()
      .nonnegative()
      .max(300000)
      .optional()
      .describe("Optional maximum time to wait in milliseconds"),
  }),
  handler: async ({ channelId, agentId, timeoutMs }) => {
    const { listAgentMemberships } = await import("@agents/server");
    const membership = (await listAgentMemberships({ kind: "channel", channelId })).find(
      (candidate) => candidate.agentId === agentId,
    );
    if (!membership) throw new Error("Agent is not a member of this channel.");

    const { waitForSession } = await import("@sessions/server/runtime");
    const { status } = await waitForSession(membership.sessionId, timeoutMs);
    return JSON.stringify({ status });
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

const listJoinedChannelsTool = defineTool("list_channels", {
  description: "Lists only channels this agent belongs to, including their stable IDs.",
  parameters: z.object({}).strict(),
  handler: async (_args, invocation) => {
    const { listJoinedChannelsForAgent } = await import("@channels/server");
    const channels = (await listJoinedChannelsForAgent(invocation.sessionId)).map(channelForTool);
    return JSON.stringify({ channels });
  },
});

const readJoinedChannelTool = defineTool("read_channel", {
  description:
    "Passively reads the newest 100 messages before an optional sequence from a channel this agent belongs to without changing its read position. Omit beforeSequence for the latest messages. While hasMore is true, continue with the first returned message's sequence. It also returns current members, shared artifacts, and attachments. File attachments are absolute paths. Inline uploads are attached images.",
  parameters: channelIdentitySchema.extend({
    beforeSequence: z.number().int().positive().optional(),
  }),
  handler: async ({ channelId, beforeSequence }, invocation) => {
    const { readJoinedChannelForAgent } = await import("@channels/server");
    return toChannelReadToolResult(
      await readJoinedChannelForAgent(invocation.sessionId, channelId, beforeSequence),
    );
  },
});

const continueInChannelTool = defineTool("continue_in_channel", {
  description:
    "Privately hands work to this agent's existing membership in a joined channel and waits for it to finish. That membership performs any public channel actions in its own context. Read the channel afterwards to verify the result.",
  parameters: channelIdentitySchema.extend({
    content: channelMessageContentSchema,
  }),
  handler: async ({ channelId, content }, invocation) => {
    const { continueAgentInChannel } = await import("@channels/server");
    const { status } = await continueAgentInChannel(invocation.sessionId, channelId, content);
    return JSON.stringify({ status });
  },
});

const sendChannelMessageTool = defineTool("send_channel_message", {
  description:
    "Publishes a Markdown channel message without ending the turn. Pass screenshot and image paths in attachments. Name-derived @mentions wake or invite agents. @everyone wakes all current members. Messages without mentions wake nobody.",
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
      waitingFor: agentMembershipStatusSchema.shape.text
        .optional()
        .describe("What this agent is waiting for after the turn ends."),
    })
    .strict(),
  isTerminal: true,
  handler: async ({ waitingFor }, invocation) => {
    const { finishCurrentAgentTurn } = await import("@agents/server/runtime");
    await finishCurrentAgentTurn(invocation.sessionId, waitingFor);
    return "Done.";
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
            ? { type: content.type, agentId: content.member.agentId }
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

export const channelAgentTools = [
  readChannelForAgentTool,
  setChannelStatusTool,
  sendChannelMessageTool,
  reactToChannelMessageTool,
  shareChannelArtifactFromAgentTool,
  finishChannelAgentTurnTool,
  listAgentsTool,
];

export const joinedChannelTools = [
  listJoinedChannelsTool,
  readJoinedChannelTool,
  continueInChannelTool,
];

export const channelTools = [
  listChannelsTool,
  createChannelTool,
  readChannelForSessionTool,
  postChannelMessageTool,
  waitForChannelAgentTool,
  shareChannelArtifactFromSessionTool,
];
