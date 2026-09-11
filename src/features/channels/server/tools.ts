import { convertMcpCallToolResult, defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { agentMentionSchema } from "@agents/model";
import {
  channelIdentitySchema,
  channelMessageContentSchema,
  channelReactionKindSchema,
  createChannelInputSchema,
  type ChannelMessage,
} from "@channels/model";

const filePathSchema = z.string().trim().min(1).max(4_096);
const shareChannelArtifactInputSchema = z
  .object({
    path: filePathSchema,
    title: z.string().trim().min(1).max(160),
  })
  .strict();

const listChannelsTool = defineTool("list_channels", {
  description: "Lists all Channels and their complete records.",
  parameters: z.object({}).strict(),
  skipPermission: true,
  handler: async () => {
    const { listChannels } = await import("@channels/server");
    return JSON.stringify({ channels: (await listChannels()).channels });
  },
});

const createChannelTool = defineTool("create_channel", {
  description: "Creates a Channel with a title and optional working directory.",
  parameters: createChannelInputSchema,
  skipPermission: true,
  handler: async (input) => {
    const { createChannel } = await import("@channels/server");
    return JSON.stringify({ channel: await createChannel(input) });
  },
});

const postChannelMessageTool = defineTool("post_channel_message", {
  description:
    "Posts a user-attributed Markdown message with optional image paths to a Channel. Relative paths use this Session's workspace. Name-derived @mentions wake or invite Agents. A message without mentions wakes all current members. Use list_channels to discover Channel IDs and list_available_agents for exact Agent mentions.",
  parameters: channelIdentitySchema.extend({
    content: channelMessageContentSchema,
    attachments: z.array(filePathSchema).optional(),
  }),
  skipPermission: true,
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
    "Reads up to 100 Channel messages after an optional sequence without changing any read cursor. It also returns current members, shared artifacts, and attached images. Omit afterSequence to read from the beginning.",
  parameters: channelIdentitySchema.extend({
    afterSequence: z.number().int().nonnegative().optional(),
  }),
  skipPermission: true,
  handler: async ({ channelId, afterSequence }) => {
    const { readChannelForSession } = await import("@channels/server");
    return toChannelReadToolResult(await readChannelForSession(channelId, afterSequence));
  },
});

const waitForChannelAgentTool = defineTool("wait_for_channel_agent", {
  description:
    "Waits for one Channel Agent's current execution to complete. Use after posting a message that wakes the Agent, then read the Channel for its public response. Timing out does not stop the Agent.",
  parameters: channelIdentitySchema.extend({
    agentId: agentMentionSchema.shape.agentId.describe("The Agent ID to wait for"),
    timeoutMs: z
      .number()
      .int()
      .nonnegative()
      .max(300000)
      .optional()
      .describe("Optional maximum time to wait in milliseconds"),
  }),
  skipPermission: true,
  handler: async ({ channelId, agentId, timeoutMs }) => {
    const { listAgentMemberships } = await import("@agents/server");
    const membership = (await listAgentMemberships({ kind: "channel", channelId })).find(
      (candidate) => candidate.agentId === agentId,
    );
    if (!membership) throw new Error("Agent is not a member of this Channel.");

    const { waitForSession } = await import("@sessions/server/runtime");
    const { status } = await waitForSession(membership.sessionId, timeoutMs);
    return JSON.stringify({ status });
  },
});

const readChannelForAgentTool = defineTool("read_channel", {
  description:
    "Reads this Agent's next unread Channel messages and attached images, then advances its cursor. It also returns the current members and shared artifacts.",
  parameters: z.object({}),
  skipPermission: true,
  handler: async (_args, invocation) => {
    const { readChannelForAgent } = await import("@channels/server");
    return toChannelReadToolResult(await readChannelForAgent(invocation.sessionId));
  },
});

const listJoinedChannelsTool = defineTool("list_channels", {
  description: "Lists only Channels this Agent belongs to, including their stable IDs.",
  parameters: z.object({}).strict(),
  skipPermission: true,
  handler: async (_args, invocation) => {
    const { listJoinedChannelsForAgent } = await import("@channels/server");
    const channels = (await listJoinedChannelsForAgent(invocation.sessionId)).map(
      ({ id: channelId, title, directory }) => ({ channelId, title, directory }),
    );
    return JSON.stringify({ channels });
  },
});

const readJoinedChannelTool = defineTool("read_channel", {
  description:
    "Passively reads up to 100 messages from a Channel this Agent belongs to without advancing that Channel membership's cursor. It also returns current members, shared artifacts, and attached images.",
  parameters: channelIdentitySchema.extend({
    afterSequence: z.number().int().nonnegative().optional(),
  }),
  skipPermission: true,
  handler: async ({ channelId, afterSequence }, invocation) => {
    const { readJoinedChannelForAgent } = await import("@channels/server");
    return toChannelReadToolResult(
      await readJoinedChannelForAgent(invocation.sessionId, channelId, afterSequence),
    );
  },
});

const continueInChannelTool = defineTool("continue_in_channel", {
  description:
    "Privately hands work to this Agent's existing membership in a joined Channel and waits for it to finish. That membership performs any public Channel actions in its own context. Read the Channel afterwards to verify the result.",
  parameters: channelIdentitySchema.extend({ content: channelMessageContentSchema }),
  skipPermission: true,
  handler: async ({ channelId, content }, invocation) => {
    const { continueAgentInChannel } = await import("@channels/server");
    const { status } = await continueAgentInChannel(invocation.sessionId, channelId, content);
    return JSON.stringify({ status });
  },
});

const sendChannelMessageTool = defineTool("send_channel_message", {
  description:
    "Publishes a Markdown Channel message without ending the turn. Name-derived @mentions wake or invite Agents. @everyone wakes all current members. Messages without mentions wake nobody. Attachments are image paths. agentMentions may supply stable IDs and initial modes for addressed Agents.",
  parameters: z.object({
    content: channelMessageContentSchema,
    attachments: z.array(filePathSchema).optional(),
    agentMentions: z.array(agentMentionSchema).max(50).optional(),
  }),
  skipPermission: true,
  handler: async (args, invocation) => {
    const { sendChannelMessageFromAgent } = await import("@channels/server");
    const message = await sendChannelMessageFromAgent(invocation.sessionId, {
      content: args.content,
      attachmentPaths: args.attachments,
      agentMentions: args.agentMentions,
    });
    return JSON.stringify({ sequence: message.sequence });
  },
});

const reactToChannelMessageTool = defineTool("react_to_channel_message", {
  description:
    "Sets this Agent's reaction to a user or Agent message, or clears it with null. Reactions neither wake Agents nor end the turn.",
  parameters: z.object({
    sequence: z.number().int().positive(),
    reaction: channelReactionKindSchema.nullable(),
  }),
  skipPermission: true,
  handler: async (args, invocation) => {
    const { setChannelMessageReactionFromAgent } = await import("@channels/server");
    const reaction = await setChannelMessageReactionFromAgent(invocation.sessionId, args);
    return JSON.stringify({ reaction });
  },
});

const shareChannelArtifactFromSessionTool = defineTool("share_channel_artifact", {
  description:
    "Adds an existing file to a Channel's shared artifact index without copying or modifying it. The path may be absolute or relative to this Session's workspace.",
  parameters: channelIdentitySchema.extend(shareChannelArtifactInputSchema.shape),
  skipPermission: true,
  handler: async (args, invocation) => {
    const { shareChannelArtifactFromSession } = await import("@channels/server");
    return JSON.stringify(await shareChannelArtifactFromSession(invocation.sessionId, args));
  },
});

const shareChannelArtifactFromAgentTool = defineTool("share_channel_artifact", {
  description:
    "Adds an existing file to the Channel's shared artifact index without copying or modifying it. The path may be absolute or relative to this Agent's workspace.",
  parameters: shareChannelArtifactInputSchema,
  skipPermission: true,
  handler: async (args, invocation) => {
    const { shareChannelArtifactFromAgent } = await import("@channels/server");
    return JSON.stringify(await shareChannelArtifactFromAgent(invocation.sessionId, args));
  },
});

function toChannelReadToolResult<T extends { messages: ChannelMessage[] }>(result: T) {
  const images = result.messages.flatMap((message) => message.attachments ?? []);
  let imageIndex = 0;
  const messages = result.messages.map(({ attachments, ...message }) => ({
    ...message,
    ...(attachments?.length
      ? {
          attachments: attachments.map(({ displayName, mimeType }) => ({
            displayName,
            mimeType,
            imageIndex: imageIndex++,
          })),
        }
      : {}),
  }));
  return convertMcpCallToolResult({
    content: [
      { type: "text", text: JSON.stringify({ ...result, messages }) },
      ...images.map(({ base64, mimeType }) => ({
        type: "image" as const,
        data: base64,
        mimeType,
      })),
    ],
  });
}

export const channelAgentTools = [
  readChannelForAgentTool,
  sendChannelMessageTool,
  reactToChannelMessageTool,
  shareChannelArtifactFromAgentTool,
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
