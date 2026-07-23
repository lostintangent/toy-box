import { describe, expect, test } from "bun:test";
import type { CommentThread } from "documint";
import { buildArtifactCommentPrompt } from "./comments";

const thread: CommentThread = {
  id: "thread-a",
  quote: "Original section",
  anchor: { prefix: "Original section" },
  comments: [{ body: "@[Copilot](copilot) make this clearer", updatedAt: "earlier" }],
};

describe("Markdown artifact comments", () => {
  test("owns the complete Documint response protocol", () => {
    const prompt = buildArtifactCommentPrompt(thread, new Date("2026-07-14T12:00:00.000Z"));

    expect(prompt).toContain("A user asked for your help in an inline comment thread");
    expect(prompt).toContain("@[Copilot](copilot) make this clearer");
    expect(prompt).toContain('Use "2026-07-14T12:00:00.000Z" for `updatedAt`');
    expect(prompt).toContain("appending that object must be the only file change");
    expect(prompt).toContain("update its `quote` to the replacement text");
    expect(prompt).toContain("Persist the answer in the artifact body or comment thread");
  });
});
