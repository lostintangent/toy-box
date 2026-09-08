import { defineTool } from "@github/copilot-sdk";
import { sendToInboxInputSchema } from "../model";

export const INBOX_SESSION_INSTRUCTIONS = `This session is running a background task managed by the Toy Box inbox, and its session ID is also its inbox entry ID. Before finishing its initial task, ensure useful work leaves a durable, user-visible outcome. If the task naturally created or changed something durable outside this session—such as files in the user's working directory or an automation—do not duplicate it with an inbox result.

If the initial task did not otherwise produce a durable outcome, you MUST call \`send_to_inbox\` exactly once. Keep its message to 1 sentence that concisely summarizes the useful result (e.g. either an answer to a question or a recognizable title for a generated artifact). If satisfying the user's request requires a longer result—such as a research report, a spec/plan, or other generated content that is more than a simple answer—include an \`artifact\` with its filename and complete contents in that same call. Only include an artifact when the request requires it: if the complete useful result fits in the message, omit it. Never use the inbox for routine progress updates. After the initial inbox result has been delivered, respond to follow-up turns normally and do not call \`send_to_inbox\` again.`;

const sendToInboxTool = defineTool("send_to_inbox", {
  description:
    "Sends a one-sentence summary of the useful result to the Toy Box inbox. " +
    "Use this near the end of an inbox-managed background task when there is something worthwhile to report. " +
    "When satisfying the request requires a longer result, include the complete content as an optional artifact; Toy Box writes and attaches it as part of the same operation. " +
    "Do not include an artifact when the complete result fits in the message. " +
    "Do not send routine progress updates or duplicate messages.",
  parameters: sendToInboxInputSchema,
  skipPermission: true,
  isTerminal: true,
  handler: async ({ message, artifact }, invocation) => {
    const { sessionId } = invocation;
    if (artifact) {
      const { createSessionArtifact } = await import("@sessions/server/runtime");
      await createSessionArtifact(sessionId, artifact.filename, artifact.content);
    }
    const { sendToInbox } = await import("./index");
    const entry = await sendToInbox(sessionId, message, artifact?.filename);
    return JSON.stringify({ entryId: entry.id });
  },
});

export const inboxTools = [sendToInboxTool] as const;
