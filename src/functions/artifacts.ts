// RPC boundary for reading, writing, and responding to artifact comments.
// Every artifact is addressed by its source session and relative path.

import { createServerFn } from "@tanstack/react-start";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { respondToArtifactComment as respondToComment } from "@/functions/artifacts/comments";
import { resolveArtifactPath } from "@/functions/artifacts/paths";

const artifactInputSchema = z.object({
  sessionId: z.string().min(1),
  path: z.string().min(1),
});

const writeArtifactInputSchema = artifactInputSchema.extend({
  content: z.string(),
});

const artifactCommentInputSchema = artifactInputSchema.extend({
  threadId: z.string().min(1),
  thread: z.object({
    quote: z.string(),
    anchor: z.record(z.string(), z.unknown()),
    comments: z
      .array(
        z.object({
          body: z.string(),
          updatedAt: z.string(),
        }),
      )
      .min(1),
    resolvedAt: z.string().optional(),
  }),
});

export type ArtifactCommentInput = z.infer<typeof artifactCommentInputSchema>;

export const readArtifact = createServerFn({ method: "GET" })
  .validator(zodValidator(artifactInputSchema))
  .handler(async ({ data }): Promise<{ content: string; timestamp: number }> => {
    const absolutePath = await requireArtifactPath(data.sessionId, data.path);
    const { readFile, stat } = await import("node:fs/promises");
    const [content, info] = await Promise.all([
      readFile(absolutePath, "utf-8"),
      stat(absolutePath),
    ]);
    return { content, timestamp: info.mtimeMs };
  });

export const writeArtifact = createServerFn({ method: "POST" })
  .validator(zodValidator(writeArtifactInputSchema))
  .handler(async ({ data }): Promise<{ timestamp: number }> => {
    const absolutePath = await requireArtifactPath(data.sessionId, data.path);
    const { stat, writeFile } = await import("node:fs/promises");
    await writeFile(absolutePath, data.content, "utf-8");
    return { timestamp: (await stat(absolutePath)).mtimeMs };
  });

/** Respond to an inline Markdown comment using its source session's context. */
export const respondToArtifactComment = createServerFn({ method: "POST" })
  .validator(zodValidator(artifactCommentInputSchema))
  .handler(({ data }): Promise<{ sessionId: string }> => respondToComment(data));

async function requireArtifactPath(sessionId: string, path: string): Promise<string> {
  const target = await resolveArtifactPath(sessionId, path);
  if (!target) throw new Error("Invalid artifact path.");
  return target;
}
