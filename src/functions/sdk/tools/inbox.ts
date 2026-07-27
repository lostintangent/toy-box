import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";

const sendToInbox = defineTool("send_to_inbox", {
  description:
    "Sends a one-sentence summary of the useful result to the Toy Box inbox. " +
    "Use this near the end of an inbox-managed background task when there is something worthwhile to report. " +
    "When satisfying the request requires a longer result, include the complete content as an optional artifact; Toy Box writes and attaches it as part of the same operation. " +
    "Do not include an artifact when the complete result fits in the message. " +
    "Do not send routine progress updates or duplicate messages.",
  parameters: z.object({
    message: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .describe("The concise inbox message to show the user"),
    artifact: z
      .object({
        filename: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .describe("A file name with an appropriate extension, such as report.md"),
        content: z.string().max(1_000_000).describe("The complete UTF-8 file contents"),
      })
      .optional()
      .describe("The complete file result when the request requires more than the message"),
  }),
  skipPermission: true,
  handler: async ({ message, artifact }, invocation) => {
    const { sessionId } = invocation;
    if (artifact) {
      const { SessionStream } = await import("@/functions/runtime/stream");
      const stream = SessionStream.get(sessionId);
      if (!stream) throw new Error("Cannot attach an inbox artifact without a running session.");
      await stream.sdkSession.rpc.workspaces.createFile({
        path: artifact.filename,
        content: artifact.content,
      });
    }
    const { sendToInbox } = await import("@/functions/state/workspace");
    const entry = await sendToInbox(sessionId, message, artifact?.filename);
    return JSON.stringify({ entryId: entry.id });
  },
});

export const inboxTools = [sendToInbox] as const;
