import { z } from "zod";

export const attachmentSchema = z.object({
  mimeType: z.string().startsWith("image/"),
  base64: z.string(),
});

export type Attachment = z.infer<typeof attachmentSchema>;

export const attachmentsSchema = z.array(attachmentSchema);
