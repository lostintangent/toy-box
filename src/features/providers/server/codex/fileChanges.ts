import type { FileUpdateChange } from "./protocol";

/** Codex sends complete contents for additions/deletions and unified hunks for
 * updates. Session edit tools expose one unified-diff format to all consumers. */
export function fileChangesDiff(changes: readonly FileUpdateChange[]): string {
  return changes.map(changeDiff).join("\n");
}

function changeDiff({ path, kind, diff }: FileUpdateChange): string {
  const target = kind.type === "update" ? (kind.move_path ?? path) : path;
  const header = `diff --git ${path} ${target}\n`;
  if (kind.type === "update") {
    // Native updates contain unified hunks; some histories also include headers.
    if (diff.startsWith("diff --git ")) return diff;
    return header + (diff.startsWith("--- ") ? diff : `--- ${path}\n+++ ${target}\n${diff}`);
  }
  const lines = diff ? diff.replace(/\n$/, "").split("\n") : [];
  const added = kind.type === "add";
  const before = added ? "/dev/null" : path;
  const after = added ? path : "/dev/null";
  const range = added ? `-0,0 +1,${lines.length}` : `-1,${lines.length} +0,0`;
  return `${header}--- ${before}\n+++ ${after}\n@@ ${range} @@\n${lines.map((line) => `${added ? "+" : "-"}${line}`).join("\n")}\n`;
}
