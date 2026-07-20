// Markdown comment threads are stored inside the artifact, so the renderer
// owns the complete protocol that tells an artifact worker how to respond.

import type { CommentThread } from "documint";

export function buildArtifactCommentPrompt(thread: CommentThread, now: Date): string {
  const latestComment = thread.comments.at(-1)!.body;

  return `A user asked for your help in an inline comment thread on a Markdown artifact. Read the latest comment and respond by updating the artifact itself.

First decide whether the comment asks for a document edit, an answer, an acknowledgement, or a mix:

- For an edit request, update the document body and add a brief thread reply summarizing the change.
- For a question, review, or request for information, preserve the document body and every existing thread field, then answer in the thread.
- For an acknowledgement or no-op, preserve the document body and only reply when useful.
- For a mixed request, make the requested edit and answer in the thread.
- When the intent is unclear, preserve the document body and ask a clarifying question in the thread.

The instructions and current thread payload below fully define the comment format. Unless the comment explicitly asks otherwise, modify only the artifact. Keep every body edit scoped to the comment and preserve unrelated content.

Documint stores comments as JSON in the trailing \`:::documint-comments\` directive in the same file. Preserve the directive and valid JSON. To reply, append exactly one object with \`body\` and \`updatedAt\` to the matching thread's \`comments\` array; do not reconstruct the thread or prefix the reply with an @copilot mention. Match the thread using its quote, anchor, and existing comments. If the document body does not change, appending that object must be the only file change: preserve \`quote\`, \`anchor\`, \`resolvedAt\`, and every existing comment exactly. If a body edit changes text covered by that thread, update its \`quote\` to the replacement text. Preserve its existing \`anchor\` unless an anchor prefix or suffix contains changed text; in that case, update only that string to the corresponding nearby text. Use ${JSON.stringify(now.toISOString())} for \`updatedAt\`.

Latest comment:
${latestComment}

Current thread:
${JSON.stringify(thread, null, 2)}

Persist the answer in the artifact body or comment thread as appropriate.`;
}
