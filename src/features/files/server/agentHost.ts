import { basename } from "node:path";
import { agentHandleFromName } from "@agents/model";
import type { AgentHostAdapter } from "@agents/server/host";
import type { MentionFileAgentInput } from "@files/model/agentMention";
import { getSessionContext } from "@sessions/server/runtime";
import { resolveWorkspaceFile } from "./paths";

/** Validate File-owned context, then hand admission to the shared Agent
 * runtime. The renderer has already flushed the Documint comment to disk. */
export async function mentionFileAgent(input: MentionFileAgentInput): Promise<void> {
  const file = {
    kind: "session" as const,
    sessionId: input.host.sessionId,
    path: input.host.path,
  };
  const absolutePath = resolveWorkspaceFile(file);
  if (!absolutePath || !(await Bun.file(absolutePath).exists())) {
    throw new Error("The Markdown artifact is no longer available.");
  }

  const context = await getSessionContext(input.host.sessionId);
  const { mentionAgent } = await import("@agents/server/supervisor");
  await mentionAgent({
    host: input.host,
    agentId: input.agentId,
    message: { content: input.prompt },
    initialExecutionMode: input.initialExecutionMode,
    directory: context?.workingDirectory,
    initialContext: context,
    hostLabel: basename(input.host.path),
  });
}

/** Markdown-file implementation of the Agent host port. The persisted file,
 * not the private Agent Session, is the shared conversation and result. */
export const fileAgentHost: AgentHostAdapter = {
  async getInstructions(agent, membership) {
    if (membership.host.kind !== "file") {
      throw new Error("File Agent membership is incomplete.");
    }
    const absolutePath = resolveWorkspaceFile({
      kind: "session",
      sessionId: membership.host.sessionId,
      path: membership.host.path,
    });
    if (!absolutePath || !(await Bun.file(absolutePath).exists())) {
      throw new Error("The Agent's Markdown artifact is no longer available.");
    }

    const mention = `@${agentHandleFromName(agent.name)}`;
    const replyPrefix = `**${mention}:** `;
    return `You are responding as ${agent.name} (${mention}) in a Markdown comment thread.
The exact shared artifact is ${JSON.stringify(absolutePath)}.

The artifact is the only public result for this host. Follow the comment protocol in the current prompt.

Reread the file immediately before every write. Preserve unrelated content and concurrent edits.

Documint comments do not store authors. Begin each reply body with ${JSON.stringify(replyPrefix)}.`;
  },
};
