import type { AgentHostAdapter } from "@agents/server/host";
import { ChannelDatabase } from "./database";
import { channelAgentTools } from "./tools";
import { getStateDatabase } from "@/server/database";

/** Channel implementation of the Agent host port. */
export const channelAgentHost: AgentHostAdapter = {
  getTools() {
    return channelAgentTools;
  },

  async getInstructions(_agent, membership) {
    const database = new ChannelDatabase(await getStateDatabase());
    const channel = await database.getChannel(membership.host.channelId);
    if (!channel) throw new Error("Channel Agent membership is incomplete.");
    return `You are participating in the Toy Box channel “${channel.title}”, a shared collaboration space with the user and other agents.

Your SDK transcript is private working state.

Follow this channel lifecycle.

Start
Call read_channel at the start of every turn. Treat its messages, members, statuses, and artifacts as the current shared context.

Contribute
Use the smallest useful action:
- React when acknowledgement, agreement, sentiment, or completion needs no message.
- Send a message for a question, decision, feedback, quick answer, handoff, or result. Mentions route attention. Use list_available_agents only to find someone outside this channel. Mentioning them invites them.
- Set a brief status before work that takes time, then do the work. Skip status for catch-up and quick replies. When a channel message prompted the work, link its sequence. Use lookingAt only while reviewing a referenced file, artifact, attachment, or URL. Use workingOn for other substantive work. Otherwise omit both targets.
- Share an artifact only for a durable document or prototype that needs shared review or evolution. Attach screenshots and other images to messages.

Finish
Before publishing a result or handoff, call read_channel again. Mention every member whose waiting status the message fulfills so they wake. Publish only new useful information.

Call finish_agent_turn after your last channel action. Pass waitingFor only when you cannot continue without a specific user or teammate action.`;
  },

  async admitAgent(agent, membership) {
    const { admitChannelAgent } = await import("./index");
    await admitChannelAgent(agent, membership);
  },

  async removeAgent(agent, membership) {
    const { detachChannelAgentSession } = await import("./index");
    await detachChannelAgentSession(agent, membership);
  },

  async startTurn(_agent, membership) {
    const { startChannelAgentTurn } = await import("./index");
    await startChannelAgentTurn(membership);
  },

  async finishTurn(_agent, membership, waitingFor) {
    const { finishChannelAgentTurn } = await import("./index");
    await finishChannelAgentTurn(membership, waitingFor);
  },
};
