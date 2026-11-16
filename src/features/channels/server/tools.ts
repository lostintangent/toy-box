import { isAbsolute, resolve } from "node:path";
import { defineTool } from "@sessions/server/tools/definition";
import { z } from "zod";
import {
  agentHandleFromName,
  channelTaskElapsedMinutes,
  channelIdentitySchema,
  conciseChannelMessageSchema,
  channelPathSchema,
  channelRepliesSchema,
  channelReactionKindSchema,
  createChannelMemberInputSchema,
  createChannelInputSchema,
  editChannelTasksInputSchema,
  durableIdSchema,
  isChannelSystemMessage,
  nameChannelTaskOwners,
  channelArtifactIdentitySchema,
  channelRoutineIdentitySchema,
  channelMemberUpdateSchema,
  selfUpdateChannelMemberInputSchema,
  setChannelAgentStatusInputSchema,
  setChannelRoutineInputSchema,
  updateChannelInputSchema,
  type Channel,
  type ChannelMessageSender,
  type ChannelAgent,
  type ChannelArtifact,
  type ChannelTask,
  type ChannelTaskInput,
} from "@channels/model";
import { workspaceFileId } from "@files/model";
import { resolveWorkspaceFile } from "@files/server/paths";
import { channelAttachmentPath } from "./attachments";
import { listPeerChannels } from "./peers";
import { channelAgentPresence } from "@channels/model/presence";
import { getSessionActivity } from "@sessions/server/state/activity";

const agentReferenceSchema = durableIdSchema.describe("A member's @mention.");
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
    "Lists channels with their stable IDs, names, avatars, purposes, lead models, and working directories.",
  parameters: z.object({}).strict(),
  handler: async () => {
    const { listChannels } = await import("@channels/server");
    return { channels: (await listChannels()).channels.map(channelForTool) };
  },
});

/** Leads also find the channels on the owner's peer servers, whose leads they can message. */
const listLeadChannelsTool: typeof listChannelsTool = {
  ...listChannelsTool,
  handler: async () => {
    const { listChannels } = await import("@channels/server");
    const [local, peers] = await Promise.all([listChannels(), listPeerChannels()]);
    return { channels: [...local.channels.map(channelForTool), ...peers] };
  },
};

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
    "Creates one or more members in a channel with unique names, optional roles, and optional models. A role states what the member is accountable for, the quality bar, and judgment specific to that work. Leave paths, commands, product behavior, and rules for anyone in the repository to its instructions or the spec, agreements specific to this team to the purpose, and task context to assignments. Use list_models to resolve supported model options. Members begin onboarding immediately. Mention the returned handles in a channel message to assign work.",
  parameters: channelIdentitySchema.extend({ members: channelMemberCreationsSchema }),
  handler: async ({ channelId, members }) => {
    const { createChannelMembers } = await import("@channels/server");
    return createdChannelMembers(await createChannelMembers(channelId, members));
  },
});

const createCurrentChannelMembersTool = defineTool("create_channel_members", {
  description:
    "Creates one or more members in this channel with unique names, optional roles, and optional models. Use list_models to resolve supported model options. Members begin onboarding immediately.",
  parameters: z.object({ members: channelMemberCreationsSchema }).strict(),
  handler: async ({ members }, sessionId) => {
    const { createChannelMembers } = await import("@channels/server");
    const created = await createChannelMembers(sessionId, members);
    return { members: created.map(({ name }) => mention(name)) };
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
    const { postChannelMessage } = await import("@channels/server");
    const message = await postChannelMessage(
      {
        id: crypto.randomUUID(),
        ...input,
        attachments: attachments && (await resolveSessionPaths(sessionId, attachments)),
      },
      { type: "user" },
    );
    return { sequence: message.sequence };
  },
});

const readChannelForSessionTool = defineTool("read_channel", {
  description:
    "Reads the channel purpose, tasks, URL or screen preview, lead, current members, shared artifacts, routines, attachments, and newest 100 messages before an optional sequence without changing read state. Omit beforeSequence for the latest messages. While hasMore is true, continue with the first returned message's sequence. Attachments are absolute paths.",
  parameters: channelIdentitySchema.extend({
    beforeSequence: z.number().int().positive().optional(),
  }),
  handler: async ({ channelId, beforeSequence }) => {
    const { readChannel } = await import("@channels/server");
    return channelReadForTool(await readChannel(channelId, beforeSequence));
  },
});

const waitForChannelAgentsTool = defineTool("wait_for_channel_agents", {
  description:
    "Waits for the channel lead or one or more members to finish their current executions. Use after creating a channel or posting a message that wakes them, then read the channel for their public responses. Timing out does not stop their executions.",
  parameters: channelIdentitySchema.extend({
    agentIds: z
      .array(durableIdSchema)
      .min(1)
      .describe(
        "The lead or one or more members to wait for, each by agent ID or @mention. The lead's agent ID is the channel ID.",
      ),
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

const channelReadDetailSchema = z.enum(["compact", "tasks", "full"]);
type ChannelReadDetail = z.output<typeof channelReadDetailSchema>;
type ChannelRead = Awaited<ReturnType<typeof import(".").readChannel>>;

const readChannelForAgentTool = defineTool("read_channel", {
  description:
    "Reads this agent's next 100 unread messages, unfinished assigned tasks (all unfinished tasks for the lead), and working or waiting agents. Advances its read position. With no read cursor, always returns full context. Set detail:'full' for the channel purpose, directory, preview, complete tasks, roster with roles and models, artifacts, and routines. Set detail:'tasks' for the complete task tree instead of unfinished tasks and agents. Repeat while hasMore is true. Attachments are absolute paths.",
  parameters: z.object({ detail: channelReadDetailSchema.optional() }),
  handler: async ({ detail = "compact" }, sessionId) => {
    const { readChannelUnread } = await import("@channels/server");
    const result = await readChannelUnread(sessionId);
    return channelReadForTool(result, result.isInitialRead ? "full" : detail, sessionId);
  },
});

const sendChannelMessageParameters = z.object({
  content: conciseChannelMessageSchema,
  attachments: z.array(channelPathSchema).optional(),
});

const sendLeadMessageParameters = sendChannelMessageParameters
  .extend({
    request: z
      .boolean()
      .optional()
      .describe(
        "Flags this message as needing the user's decision, context, or action until the user next posts.",
      ),
    replies: channelRepliesSchema
      .optional()
      .describe(
        "Two to four short answers the user can post with one click, such as Yes and Not yet, with your recommendation first. Requires request.",
      ),
  })
  .refine(({ request, replies }) => !replies || request, {
    message: "Suggested replies belong to a request.",
  });

const sendChannelMessageTool = defineTool("send_channel_message", {
  description:
    "Publishes a Markdown channel message without ending the turn. Pass screenshot, image, and video paths in attachments, including a generated image's saved file path. Name-derived @mentions wake the addressed agents. @everyone wakes the lead and all members. Without mentions, member messages wake the lead and lead messages wake nobody.",
  parameters: sendChannelMessageParameters,
  handler: async (
    { attachments, ...input }: z.output<typeof sendLeadMessageParameters>,
    sessionId,
  ) => {
    const { postChannelMessage, requireChannelAgent } = await import("@channels/server");
    const { channelId } = await requireChannelAgent(sessionId);
    const message = await postChannelMessage(
      {
        id: crypto.randomUUID(),
        channelId,
        ...input,
        attachments: attachments && (await resolveSessionPaths(sessionId, attachments)),
      },
      { type: "agent", agentId: sessionId },
    );
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
    const { setChannelMessageReaction } = await import("@channels/server");
    await setChannelMessageReaction(sessionId, args);
    return "Done";
  },
});

const setChannelStatusTool = defineTool("set_agent_status", {
  description:
    "Sets this agent's brief channel status without posting a message, waking agents, or ending the turn.",
  parameters: setChannelAgentStatusInputSchema,
  handler: async (args, sessionId) => {
    const { setChannelAgentStatus } = await import("@channels/server");
    await setChannelAgentStatus(sessionId, args);
    return "Done";
  },
});

const updateChannelTool = defineTool("update_channel", {
  description:
    "Updates this channel's name, purpose, working directory, preview, or avatar. Use an existing absolute directory. Set preview to {kind:'url',url} or {kind:'screen',screenId} from list_screens. A screen reference opens an existing host display or window; it does not launch an app. Preserve root-relative preview URLs.",
  parameters: updateChannelInputSchema,
  handler: async (args, sessionId) => {
    const { updateChannel } = await import("@channels/server");
    const image = args.avatar && "image" in args.avatar && args.avatar.image;
    const avatar = image
      ? { image: (await resolveSessionPaths(sessionId, [image]))[0]! }
      : undefined;
    await updateChannel(sessionId, avatar ? { ...args, avatar } : args);
    return "Done";
  },
});

const editChannelTasksTool = defineTool("edit_channel_tasks", {
  description:
    "Adds, updates, removes, or moves this channel's tasks by stable ID in one atomic batch.",
  parameters: editChannelTasksInputSchema,
  handler: async (input, sessionId) => {
    const { editChannelTasks } = await import("@channels/server");
    await editChannelTasks(sessionId, input);
    return "Done";
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
    "Ends this private agent turn and clears its active channel status. waitingFor leaves a brief waiting status.",
  parameters: finishChannelAgentTurnParameters,
  // TODO: Restore isTerminal after https://github.com/github/copilot-cli/issues/4755 is fixed.
  handler: async ({ waitingFor, wakeAfterMinutes }, sessionId) => {
    const { finishChannelAgentTurn } = await import("@channels/server");
    await finishChannelAgentTurn(sessionId, waitingFor, wakeAfterMinutes);
    return "Done";
  },
});

const setRoutineTool = defineTool("set_routine", {
  description:
    "Adds a routine that privately wakes you with its prompt on its schedule, or changes one by routineId. Posts a system message to the channel.",
  parameters: setChannelRoutineInputSchema,
  handler: async (input, sessionId) => {
    const { setChannelRoutine } = await import("@channels/server");
    const routine = await setChannelRoutine(sessionId, input);
    return { routineId: routine.id };
  },
});

const deleteRoutineTool = defineTool("delete_routine", {
  description: "Deletes one of this channel's routines and posts a system message.",
  parameters: channelRoutineIdentitySchema.omit({ channelId: true }),
  handler: async ({ routineId }, sessionId) => {
    const { deleteChannelRoutine } = await import("@channels/server");
    if (!(await deleteChannelRoutine(sessionId, routineId))) {
      throw new Error("Routine not found in this channel.");
    }
    return "Done";
  },
});

const removeArtifactTool = defineTool("remove_channel_artifact", {
  description:
    "Removes one of this channel's shared artifacts and posts a system message. The file stays on disk, and tasks linked to it are unlinked.",
  parameters: channelArtifactIdentitySchema.omit({ channelId: true }),
  handler: async ({ artifactId }, sessionId) => {
    const { removeChannelArtifact } = await import("@channels/server");
    if (
      !(await removeChannelArtifact(sessionId, artifactId, { type: "agent", agentId: sessionId }))
    ) {
      throw new Error("Artifact not found in this channel.");
    }
    return "Done";
  },
});

const messageChannelLeadTool = defineTool("message_channel_lead", {
  description:
    "Privately messages another channel's lead, found with list_channels, and wakes it. The exchange stays in the two leads' sessions. Replies arrive as private messages naming the sender's channel. A channel with a `server` is on another of the owner's Toy Box servers, where only your words arrive, so share work as pushed branches or in the message itself, never as paths, local URLs or artifacts.",
  parameters: channelIdentitySchema.extend({ content: conciseChannelMessageSchema }),
  handler: async (input, sessionId) => {
    const { messageChannelLead } = await import("@channels/server");
    await messageChannelLead(sessionId, input);
    return "Done";
  },
});

const updateMemberTool = defineTool("update_member", {
  description: "Updates this channel agent's role, avatar, or both.",
  parameters: selfUpdateChannelMemberInputSchema,
  handler: async (args, sessionId) => {
    const { updateChannelMember } = await import("@channels/server");
    await updateChannelMember({ agentId: sessionId, ...args });
    return "Done";
  },
});

const updateChannelMemberTool = defineTool("update_channel_member", {
  description:
    "Updates a member's name, role, or model from its next turn. A started member keeps its provider. Use list_models to resolve supported model options.",
  parameters: channelMemberUpdateSchema.safeExtend({ agent: agentReferenceSchema }),
  handler: async ({ agent, ...changes }, sessionId) => {
    const { resolveChannelMember, updateChannelMember } = await import("@channels/server");
    const agentId = await resolveChannelMember(sessionId, agent);
    return { agent: mention((await updateChannelMember({ ...changes, agentId })).name) };
  },
});

const removeChannelMemberTool = defineTool("remove_channel_member", {
  description:
    "Removes a member from this channel and posts a system message. Its session ends, and the tasks it owned lose their owner.",
  parameters: z.object({ agent: agentReferenceSchema }).strict(),
  handler: async ({ agent }, sessionId) => {
    const { removeChannelMember, resolveChannelMember } = await import("@channels/server");
    const memberId = await resolveChannelMember(sessionId, agent);
    await removeChannelMember(memberId, { type: "agent", agentId: sessionId });
    return "Done";
  },
});

const shareChannelArtifactFromSessionTool = defineTool("share_channel_artifact", {
  description:
    "Registers an existing standalone file once for the channel to review or evolve without copying it. Later file edits appear automatically, and sharing the same file and title again is a no-op. The path may be absolute or relative to this session's workspace.",
  parameters: channelIdentitySchema.extend(shareChannelArtifactInputSchema.shape),
  handler: async ({ path, ...input }, sessionId) => {
    const { shareChannelArtifact } = await import("@channels/server");
    const [workspacePath] = await resolveSessionPaths(sessionId, [path]);
    return artifactForTool(
      await shareChannelArtifact({ ...input, path: workspacePath! }, { type: "user" }),
    );
  },
});

const shareChannelArtifactFromAgentTool = defineTool("share_channel_artifact", {
  description:
    "Registers an existing standalone file once for the channel to review or evolve without copying it. Later file edits appear automatically, and sharing the same file and title again is a no-op. The path may be absolute or relative to this agent's workspace.",
  parameters: shareChannelArtifactInputSchema,
  handler: async ({ path, title }, sessionId) => {
    const { requireChannelAgent, shareChannelArtifact } = await import("@channels/server");
    const { channelId } = await requireChannelAgent(sessionId);
    const [workspacePath] = await resolveSessionPaths(sessionId, [path]);
    const artifact = await shareChannelArtifact(
      { channelId, path: workspacePath!, title },
      { type: "agent", agentId: sessionId },
    );
    return { artifactId: workspaceFileId(artifact.file) };
  },
});

/** In tool input, a relative path means the calling Session's workspace. Without one, it stays relative. */
async function resolveSessionPaths(sessionId: string, paths: readonly string[]) {
  if (paths.every((path) => isAbsolute(path))) return [...paths];
  const { getSessionDirectory } = await import("@sessions/server/runtime");
  const directory = await getSessionDirectory(sessionId);
  return paths.map((path) => (directory ? resolve(directory, path) : path));
}

function channelReadForTool(
  result: ChannelRead,
  detail: ChannelReadDetail = "full",
  agentId?: string,
) {
  // Channel agents read who acts by handle, and Sessions the stored identities their tools take.
  const handle = actorHandles([result.lead, ...result.members]);
  const who = (actor: ChannelMessageSender) => (agentId ? handle(actor) : actor);
  const messages = result.messages.map((message) => {
    const sender = who(message.sender);
    if (isChannelSystemMessage(message)) {
      const { id: _id, content, ...rest } = message;
      const actor = "actor" in content && { actor: who(content.actor) };
      if ("member" in content) {
        const { member, ...change } = content;
        // Membership notices name the member as it was then, even once it has left.
        const agent = agentId ? { member: mention(member.name) } : { agentId: member.id };
        return { ...rest, sender, content: { ...change, ...actor, ...agent } };
      }
      return {
        ...rest,
        sender,
        content: {
          ...content,
          ...actor,
          ...("artifact" in content && { artifact: artifactForTool(content.artifact) }),
        },
      };
    }
    const { id, ...rest } = message;
    return {
      ...rest,
      sender,
      ...(agentId &&
        rest.reactions && {
          reactions: rest.reactions.map(({ agentId, reaction }) => ({
            agent: handle({ type: "agent", agentId }),
            reaction,
          })),
        }),
      ...(rest.attachments && {
        attachments: rest.attachments.map(({ name }) =>
          channelAttachmentPath(result.channel.id, id, name),
        ),
      }),
    };
  });
  return {
    ...channelReadContextForTool(result, detail, handle, agentId),
    messages,
    hasMore: result.hasMore,
  };
}

function channelReadContextForTool(
  result: ChannelRead,
  detail: ChannelReadDetail,
  handle: ActorHandle,
  agentId?: string,
) {
  switch (detail) {
    case "compact":
      return {
        unfinishedTasks: unfinishedTasksForTool(
          result.channel.tasks,
          handle,
          !agentId || agentId === result.lead.id ? undefined : handle({ type: "agent", agentId }),
          Date.now(),
        ),
        agents: [result.lead, ...result.members]
          .map((agent) => agentForTool(agent, true))
          .filter((agent) => agent.status)
          .map(({ role: _role, ...agent }) => agent),
      };
    case "tasks":
      return { tasks: nameChannelTaskOwners(result.channel.tasks, handle) };
    case "full":
      return {
        channel: channelContextForTool(result.channel, handle),
        lead: agentForTool(result.lead, !!agentId),
        members: result.members.map((member) => ({
          ...agentForTool(member, !!agentId),
          model: member.model,
        })),
        artifacts: result.artifacts.map(artifactForTool),
        routines: result.routines.map(({ id, ...routine }) => ({
          routineId: id,
          ...routine,
        })),
      };
  }
}

function channelContextForTool(
  { name, purpose, directory, tasks, preview }: Channel,
  handle: ActorHandle,
) {
  return { name, purpose, directory, tasks: nameChannelTaskOwners(tasks, handle), preview };
}

/** A handle is @user or a current agent's mention. A removed agent, like the system, has none. */
function actorHandles(agents: readonly ChannelAgent[]) {
  const mentions = new Map(agents.map(({ id, name }) => [id, mention(name)]));
  return (actor: ChannelMessageSender) =>
    actor.type === "user"
      ? "@user"
      : actor.type === "agent"
        ? mentions.get(actor.agentId)
        : undefined;
}
type ActorHandle = ReturnType<typeof actorHandles>;

type UnfinishedTask = Omit<ChannelTaskInput, "children"> & {
  elapsedMinutes?: number;
  children?: UnfinishedTask[];
};

function unfinishedTasksForTool(
  tasks: readonly ChannelTask[],
  handle: ActorHandle,
  owner: string | undefined,
  now: number,
): UnfinishedTask[] {
  return tasks.flatMap(({ owner: actor, startedAt, children, ...task }) => {
    const taskOwner = actor && handle(actor);
    const unfinishedChildren = unfinishedTasksForTool(children ?? [], handle, owner, now);
    if (
      !unfinishedChildren.length &&
      (task.status === "done" || (owner !== undefined && taskOwner !== owner))
    ) {
      return [];
    }
    return [
      {
        ...task,
        ...(taskOwner && { owner: taskOwner }),
        elapsedMinutes: channelTaskElapsedMinutes({ startedAt }, now),
        ...(unfinishedChildren.length ? { children: unfinishedChildren } : {}),
      },
    ];
  });
}

function mention(name: string) {
  return `@${agentHandleFromName(name)}`;
}

function agentForTool(agent: ChannelAgent, byHandle: boolean) {
  const presence = channelAgentPresence(agent, getSessionActivity(agent.id)?.status === "running");
  const handle = mention(agent.name);
  return {
    ...(byHandle ? { agent: handle } : { agentId: agent.id, name: agent.name, mention: handle }),
    role: agent.role,
    ...(presence.state !== "idle"
      ? { status: { ...(agent.status?.state === presence.state ? agent.status : {}), ...presence } }
      : {}),
  };
}

function artifactForTool({ file, title }: Pick<ChannelArtifact, "file" | "title">) {
  return { artifactId: workspaceFileId(file), path: resolveWorkspaceFile(file)!, title };
}

function channelForTool({
  id: channelId,
  name,
  avatar,
  purpose,
  directory,
  model,
}: Omit<Channel, "tasks">) {
  return {
    channelId,
    name,
    ...(avatar ? { avatar } : {}),
    ...(purpose ? { purpose } : {}),
    directory,
    model,
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

/**
 * Receiving these is a lead's authority. A lead's Session ID is its Channel's ID, so each
 * acts on the Channel that its calling Session's ID names.
 */
export const channelLeadTools = [
  ...commonChannelAgentTools,
  sendLeadMessageTool,
  createCurrentChannelMembersTool,
  updateChannelMemberTool,
  removeChannelMemberTool,
  updateChannelTool,
  editChannelTasksTool,
  setRoutineTool,
  deleteRoutineTool,
  removeArtifactTool,
  listLeadChannelsTool,
  messageChannelLeadTool,
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
