import { z } from "zod";

const safePathSegmentSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      value !== "." &&
      value !== ".." &&
      !value.includes("/") &&
      !value.includes("\\") &&
      !value.includes("\0"),
    "Must be one safe path segment",
  );

export const inboxEntryIdSchema = safePathSegmentSchema.describe("The Inbox entry ID");

export const inboxArtifactFilenameSchema = safePathSegmentSchema.describe("The artifact file name");

export type InboxEntry = {
  id: string;
  message?: string;
  createdAt: string;
  artifact?: string;
};

export const inboxEntryIdInputSchema = z.object({
  entryId: inboxEntryIdSchema,
});

export const sendToInboxInputSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .describe("The concise Inbox message to show the user"),
  artifact: z
    .object({
      filename: inboxArtifactFilenameSchema.describe(
        "A file name with an appropriate extension, such as report.md",
      ),
      content: z.string().max(1_000_000).describe("The complete UTF-8 file contents"),
    })
    .optional()
    .describe("The complete file result when the request requires more than the message"),
});
