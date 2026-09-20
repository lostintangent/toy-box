import { agentHandleFromName, type ChannelMember } from "@channels/model";
import { appLifecycleTools, artifactAppTools, createAppStateTools } from "@apps/server/tools";
import { automationTools } from "@automations/server/tools";
import { listModels } from "@providers/server";
import type { ModelConfiguration } from "@providers/model";
import { modelTools } from "@sessions/server/tools";
import { readSession } from "@sessions/server/state/sessions";
import { getSettings } from "@workspace/server/state/settings";
import type { Worker } from "@workers/model";
import { getStateDatabase } from "@/server/database";
import { ChannelDatabase, channelMemberFromWorker } from "./database";
import { channelAgentTools } from "./tools";

export async function getChannelAgentConfiguration(worker: Extract<Worker, { type: "channel" }>) {
  const database = new ChannelDatabase(await getStateDatabase());
  const channel = await database.getChannel(worker.channelId);
  if (!channel) throw new Error("Channel agent is incomplete.");
  const agent = channelMemberFromWorker(worker);
  const model = agent.model ?? (await getWorkspaceDefaultModel(worker.sessionId));
  const additionalInstructions = buildChannelAgentInstructions(agent, channel.title);
  return {
    tools: [
      ...artifactAppTools,
      ...appLifecycleTools,
      ...automationTools,
      ...createAppStateTools(),
      ...modelTools,
      ...channelAgentTools,
    ],
    additionalInstructions,
    configurationKey: JSON.stringify([model, additionalInstructions]),
    disableMemory: true as const,
    ...(model ? { model } : {}),
  };
}

function buildChannelAgentInstructions(agent: ChannelMember, channelTitle: string): string {
  const avatarText = agent.avatar ? `${agent.avatar.color} self-authored mark` : "Not chosen yet.";
  const onboardingProcess =
    !agent.role && !agent.avatar
      ? "This is your first engagement. Before finishing, use update_agent once to define your role and any behavioral details, then design a distinctive avatar that reflects how you contribute."
      : !agent.role
        ? "Before finishing, use update_agent to define your role in this channel and any behavioral details that shape how you contribute."
        : !agent.avatar
          ? "Before finishing, use update_agent to design a distinctive avatar that reflects your role."
          : undefined;

  return `<your_identity>
You are ${agent.name} (@${agentHandleFromName(agent.name)}), an agent in the Toy Box channel “${channelTitle}”.

Role:
${agent.role ?? "Not established yet."}

Avatar: ${avatarText}

Use update_agent when your identity in this channel changes.
</your_identity>

${onboardingProcess ? `<onboarding_process>\n${onboardingProcess}\n</onboarding_process>\n\n` : ""}<collaboration_protocol>
This channel is a shared collaboration space with the user and other agents. Your SDK transcript is private working state.

Start
Call read_channel at the start of every turn. Treat its messages, members, statuses, and artifacts as the current shared context.

Contribute
Use the smallest useful action:
- React when acknowledgement, agreement, sentiment, or completion needs no message.
- Send a message for a question, decision, feedback, quick answer, handoff, or result. Mentions route attention.
- Set a brief status before work that takes time, then do the work. Skip status for catch-up and quick replies. When a channel message prompted the work, link its sequence. Use lookingAt only while reviewing a referenced file, artifact, attachment, or URL. Use workingOn for other substantive work. Otherwise omit both targets.
- Share an artifact only for a durable document or prototype that needs shared review or evolution. Attach screenshots and other images to messages.

Finish
Before publishing a result or handoff, call read_channel again. Mention every member whose waiting status the message fulfills so they wake. Publish only new useful information.

Call finish_agent_turn after your last channel action. Pass waitingFor only when you cannot continue without a specific user or teammate action.

Write public messages like you speak to a colleague. Match the user's tone, not another agent's. Use ordinary conversational openings and transitions. Say “I found one issue” rather than announcing a report label or verdict. Avoid compressed report prose. Keep only useful detail, using short paragraphs, Markdown lists, or code when they improve readability. Skip self-introductions, private narration, and repetition. Never use em dashes or semicolons.
</collaboration_protocol>`;
}

async function getWorkspaceDefaultModel(
  sessionId: string,
): Promise<ModelConfiguration | undefined> {
  const provider = (await readSession(sessionId))?.provider;
  const settings = await getSettings();
  if (
    settings.defaultModel &&
    (provider || !settings.disabledProviders.includes(settings.defaultModel.provider))
  ) {
    return !provider || settings.defaultModel.provider === provider.id
      ? settings.defaultModel
      : undefined;
  }
  const model = (await listModels()).find(
    (candidate) => !provider || candidate.provider === provider.id,
  );
  return model ? { name: model.id, provider: model.provider } : undefined;
}
