import type { FileEditOutput, FileWriteOutput } from "@anthropic-ai/claude-agent-sdk/sdk-tools";

/** Supply native edit hunks to the existing shared diff parser and counter. */
export function fileChangeDetails(result: FileEditOutput | FileWriteOutput): string | undefined {
  if (result.staged) return undefined;
  const created = "type" in result && result.type === "create";
  const hunks = result.structuredPatch.map((hunk) =>
    [
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      ...hunk.lines,
    ].join("\n"),
  );
  if (created && !hunks.length && "content" in result) {
    const lines = result.content.replace(/\n$/, "").split("\n");
    if (result.content)
      hunks.push(`@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`);
  }
  return [
    `--- ${created ? "/dev/null" : result.filePath}`,
    `+++ ${result.filePath}`,
    ...hunks,
  ].join("\n");
}
