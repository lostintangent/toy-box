import { z } from "zod";
import type { Worker } from "@workers/model";

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

const inboxArtifactPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine(
    (path) =>
      !path.startsWith("~/") &&
      path.split("/").every((segment) => safePathSegmentSchema.safeParse(segment).success),
    "Must be a relative file path beneath this session's artifacts directory",
  );

export type InboxEntry = {
  id: string;
  createdAt: string;
} & (
  | { kind: "pending" }
  | { kind: "result"; message: string; artifact?: string }
  | { kind: "error"; error: string }
);

export const inboxEntryIdInputSchema = z.object({
  entryId: inboxEntryIdSchema,
});

export const inboxResultSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .describe("The concise Inbox message to show the user"),
  artifact: inboxArtifactPathSchema
    .optional()
    .describe(
      "An existing file relative to this session's artifacts directory, such as reports/research.md. Write the file before calling this tool.",
    ),
});

export const inboxFailureSchema = z.object({
  error: z.string().trim().min(1).max(4000),
});

export function inboxEntryFromWorker(worker: Extract<Worker, { type: "inbox" }>): InboxEntry {
  const entry = { id: worker.sessionId, createdAt: worker.createdAt };
  if (worker.metadata === undefined) return { ...entry, kind: "pending" };

  const result = inboxResultSchema.safeParse(worker.metadata);
  if (result.success) return { ...entry, kind: "result", ...result.data };
  const failure = inboxFailureSchema.safeParse(worker.metadata);
  if (failure.success) return { ...entry, kind: "error", ...failure.data };
  return { ...entry, kind: "error", error: "This Inbox result could not be read." };
}
