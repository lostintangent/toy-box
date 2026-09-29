import { stat } from "node:fs/promises";
import { resolveSessionArtifactPath } from "@files/server/paths";
import { defineTool } from "@sessions/server/tools/definition";
import { inboxResultSchema } from "../model";

export const INBOX_SESSION_INSTRUCTIONS = `This session is running a background task managed by the Toy Box inbox, and its session ID is also its inbox entry ID. Before finishing its initial task, ensure useful work leaves a durable, user-visible outcome. If the task naturally created or changed something durable outside this session, such as files in the user's working directory or an automation, do not duplicate it with an inbox result.

If the initial task did not otherwise produce a durable outcome, you MUST call \`send_to_inbox\`. Keep its message to 1 sentence that concisely summarizes the useful result (e.g. either an answer to a question or a recognizable title for a generated artifact). If satisfying the user's request requires a longer result, such as a research report, a spec/plan, or other generated content that is more than a simple answer, first write the file in this session's artifacts directory, then pass its relative path as \`artifact\` (for example, \`reports/research.md\`). Only include an artifact when the request requires it. If the complete useful result fits in the message, omit it. Never use the inbox for routine progress updates. This tool ends the current turn. On follow-up turns, respond normally unless the user needs the Inbox result updated; calling the tool again replaces the previous message and artifact reference. Omitting the artifact clears its reference without deleting the file.`;

const sendToInboxTool = defineTool("send_to_inbox", {
  description:
    "Sends a one-sentence summary of the useful result to the Toy Box inbox. " +
    "Use this near the end of an inbox-managed background task when there is something worthwhile to report. " +
    "When satisfying the request requires a longer result, first write a file in this session's artifacts directory and include its relative path as the optional artifact. " +
    "Do not include an artifact when the complete result fits in the message. " +
    "This ends the current turn and replaces any previous Inbox result; omitting the artifact clears its previous reference. " +
    "Do not send routine progress updates.",
  parameters: inboxResultSchema,
  isTerminal: true,
  handler: async ({ message, artifact }, invocation) => {
    const { sessionId } = invocation;
    if (artifact) {
      const path = resolveSessionArtifactPath(sessionId, artifact);
      if (!path)
        throw new Error("Artifact must be a path beneath this session's artifacts directory.");
      if (!(await stat(path)).isFile())
        throw new Error("Artifact must reference an existing file.");
    }
    const { sendToInbox } = await import("./index");
    await sendToInbox(sessionId, message, artifact);
    return JSON.stringify({ entryId: sessionId });
  },
});

export const inboxTools = [sendToInboxTool] as const;
