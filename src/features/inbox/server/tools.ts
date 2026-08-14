import { defineTool } from "@github/copilot-sdk";
import { sendToInboxInputSchema } from "../model";

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
