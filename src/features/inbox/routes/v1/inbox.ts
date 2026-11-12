import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dispatchInboxTask } from "@inbox/server";
import { attachmentsSchema } from "@/shared/attachments/model";
import { invalidRequest, readInput, respond } from "@/shared/server/http";

const inboxInputSchema = z.object({
  prompt: z.string().trim().min(1),
  attachments: attachmentsSchema.optional(),
});

export const Route = createFileRoute("/api/v1/inbox")({
  server: {
    handlers: {
      POST: ({ request }) =>
        respond("start an Inbox task", async () => {
          const input = await readInboxInput(request);
          const result = await dispatchInboxTask({
            message: { content: input.prompt, attachments: input.attachments },
          });
          return Response.json(result, { status: 202 });
        }),
    },
  },
});

async function readInboxInput(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("multipart/form-data")) return readInput(request, inboxInputSchema);

  const formData = await request.formData().catch(() => {
    throw invalidRequest();
  });
  const attachments = await Promise.all(
    formData
      .getAll("attachments")
      .filter((entry) => entry instanceof File)
      .map(async (file) => ({
        mimeType: file.type || "application/octet-stream",
        base64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      })),
  );
  const input = inboxInputSchema.safeParse({
    prompt: formData.get("prompt") ?? formData.get("transcription"),
    attachments: attachments.length ? attachments : undefined,
  });
  if (!input.success) throw invalidRequest();
  return input.data;
}
