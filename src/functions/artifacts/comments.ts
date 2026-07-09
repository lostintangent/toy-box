// Inline artifact comments enqueue focused child sessions. Workspace state
// owns each comment-session link so every client can project presence;
// the artifact and its comment thread remain the durable result.

import { stat } from "node:fs/promises";
import type { ArtifactCommentInput } from "@/functions/artifacts";
import { readSessionContext } from "@/functions/sdk/client";
import { createSession, SessionStream } from "@/functions/runtime/stream";
import { sharedMap } from "@/functions/runtime/processState";
import { deleteSessionIfExists } from "@/functions/state/session/registry";
import { loadSessionSnapshot } from "@/functions/state/session/snapshots";
import {
  hasArtifactCommentSession,
  linkArtifactCommentSession,
  unlinkArtifactCommentSession,
} from "@/functions/state/workspace";
import { resolveArtifactPath } from "@/functions/artifacts/paths";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";

const artifactQueues = sharedMap<Promise<void>>("artifact-comment-queues");

export async function respondToArtifactComment(
  input: ArtifactCommentInput,
): Promise<{ sessionId: string }> {
  const absolutePath = await resolveArtifactPath(input.sessionId, input.path);
  if (!absolutePath || !(await stat(absolutePath)).isFile()) {
    throw new Error("Invalid artifact path.");
  }
  const sessionId = `${SESSION_ID_PREFIX}${crypto.randomUUID()}`;
  linkArtifactCommentSession({
    sessionId,
    sourceSessionId: input.sessionId,
    path: input.path,
    threadId: input.threadId,
  });
  enqueueArtifactCommentSession(absolutePath, sessionId, () =>
    runArtifactCommentSession(input, absolutePath, sessionId),
  );
  return { sessionId };
}

async function runArtifactCommentSession(
  input: ArtifactCommentInput,
  absolutePath: string,
  sessionId: string,
): Promise<void> {
  const sourceSessionId = input.sessionId;
  try {
    const sourceStream = SessionStream.get(sourceSessionId);
    const [sourceContext, sourceSnapshot] = await Promise.all([
      readSessionContext(sourceSessionId),
      sourceStream ? undefined : loadSessionSnapshot(sourceSessionId),
    ]);
    const model = sourceStream?.getSessionState().model ?? sourceSnapshot?.model;
    const receipt = await createSession(
      sessionId,
      {
        content: buildArtifactCommentPrompt(input, absolutePath, new Date()),
        model,
      },
      {
        directory: sourceContext?.workingDirectory,
        initialContext: sourceContext,
        parentSessionId: sourceSessionId,
        useWorktree: false,
      },
    );

    const completion = await receipt.waitForCompletion();
    if (completion.status !== "completed") {
      throw new Error("The artifact comment session did not complete.");
    }
  } finally {
    unlinkArtifactCommentSession(sessionId);
    await deleteSessionIfExists(sessionId);
  }
}

function enqueueArtifactCommentSession(
  absolutePath: string,
  sessionId: string,
  run: () => Promise<void>,
): void {
  const previous = artifactQueues.get(absolutePath) ?? Promise.resolve();
  const current = previous
    .then(async () => {
      if (hasArtifactCommentSession(sessionId)) await run();
    })
    .catch((error) => {
      console.error("Artifact comment session failed:", error);
    })
    .finally(() => {
      if (artifactQueues.get(absolutePath) === current) artifactQueues.delete(absolutePath);
    });
  artifactQueues.set(absolutePath, current);
}

export function buildArtifactCommentPrompt(
  input: ArtifactCommentInput,
  absolutePath: string,
  now: Date,
): string {
  const latestComment = input.thread.comments.at(-1)!.body;

  return `A user asked for your help in an inline comment thread on a Markdown artifact. Read the latest comment and respond by updating the artifact itself.

First decide whether the comment asks for a document edit, an answer, an acknowledgement, or a mix:

- For an edit request, update the document body and add a brief thread reply summarizing the change.
- For a question, review, or request for information, preserve the document body and every existing thread field, then answer in the thread.
- For an acknowledgement or no-op, preserve the document body and only reply when useful.
- For a mixed request, make the requested edit and answer in the thread.
- When the intent is unclear, preserve the document body and ask a clarifying question in the thread.

The artifact is ${absolutePath}. Read it immediately before editing and modify that exact file without creating a copy. The instructions and current thread payload below fully define the comment format. Inspect other files whenever the latest comment requires additional context. Unless the comment explicitly asks otherwise, modify only the artifact. Keep every body edit scoped to the comment and preserve unrelated content.

Documint stores comments as JSON in the trailing \`:::documint-comments\` directive in the same file. Preserve the directive and valid JSON. To reply, append exactly one object with \`body\` and \`updatedAt\` to the matching thread's \`comments\` array; do not reconstruct the thread or prefix the reply with an @copilot mention. Match the thread using its quote, anchor, and existing comments. If the document body does not change, appending that object must be the only file change: preserve \`quote\`, \`anchor\`, \`resolvedAt\`, and every existing comment exactly. If a body edit changes text covered by that thread, update its \`quote\` to the replacement text. Preserve its existing \`anchor\` unless an anchor prefix or suffix contains changed text; in that case, update only that string to the corresponding nearby text. Use ${JSON.stringify(now.toISOString())} for \`updatedAt\`.

Latest comment:
${latestComment}

Current thread:
${JSON.stringify(input.thread, null, 2)}

Do not leave the substantive answer only in your final response. Persist it in the artifact body or comment thread as appropriate.`;
}
