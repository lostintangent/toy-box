import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dispatchInboxTask } from "@/functions/inbox/dispatcher";
import { sessionAttachmentsSchema } from "@/lib/session/protocol";

const inboxInputSchema = z.object({
  prompt: z.string().trim().min(1),
  attachments: sessionAttachmentsSchema,
});

type InboxInput = z.infer<typeof inboxInputSchema>;

export const Route = createFileRoute("/api/inbox")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let input: InboxInput;
        try {
          input = await parseInboxInput(request);
        } catch {
          return Response.json({ error: "Invalid inbox request." }, { status: 400 });
        }

        const result = await dispatchInboxTask({
          message: { content: input.prompt, attachments: input.attachments },
        });

        return Response.json(result, { status: 202 });
      },
    },
  },
});

async function parseInboxInput(request: Request): Promise<InboxInput> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return inboxInputSchema.parse(await request.json());
  }

  if (!contentType.includes("multipart/form-data")) {
    throw new Error("Unsupported content type.");
  }

  const formData = await request.formData();
  const attachments = await Promise.all(
    formData
      .getAll("attachments")
      .filter((entry) => entry instanceof File)
      .map(async (file) => ({
        displayName: file.name,
        mimeType: file.type || "application/octet-stream",
        base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      })),
  );

  return inboxInputSchema.parse({
    prompt: formData.get("prompt"),
    attachments: attachments.length ? attachments : undefined,
  });
}
