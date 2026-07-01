import { describe, expect, test } from "bun:test";
import {
  computeFileDiffStats,
  getToolCallFileDiffs,
  parsePatch,
  parsePatchTouchedFiles,
} from "./fileDiffs";
import type { ToolCall } from "@/types";

const cwd = "/Users/lostintangent/Desktop/toy-box";

describe("file diff parsing", () => {
  test("parses unified diffs as multi-file diffs", () => {
    const fileDiffs = parsePatch(
      `
diff --git a/Users/lostintangent/Desktop/toy-box/docs/notes.md b/Users/lostintangent/Desktop/toy-box/docs/notes.md
index 0000000..0000000 100644
--- a/Users/lostintangent/Desktop/toy-box/docs/notes.md
+++ b/Users/lostintangent/Desktop/toy-box/docs/notes.md
@@ -1,3 +1,3 @@
 unchanged
-old line
+new line
 end
diff --git a/Users/lostintangent/Desktop/toy-box/docs/old.md b/Users/lostintangent/Desktop/toy-box/docs/old.md
deleted file mode 100644
index 0000000..0000000
--- a/Users/lostintangent/Desktop/toy-box/docs/old.md
+++ b/dev/null
@@ -1,3 +0,0 @@
-first
-second
-third
diff --git a/Users/lostintangent/Desktop/toy-box/docs/new.md b/Users/lostintangent/Desktop/toy-box/docs/new.md
new file mode 100644
index 0000000..0000000
--- a/dev/null
+++ b/Users/lostintangent/Desktop/toy-box/docs/new.md
@@ -0,0 +1,2 @@
+first
+second`,
      cwd,
    );

    expect(fileDiffs.map((file) => ({ path: file.path, status: file.status }))).toEqual([
      { path: "/Users/lostintangent/Desktop/toy-box/docs/notes.md", status: "modified" },
      { path: "/Users/lostintangent/Desktop/toy-box/docs/old.md", status: "deleted" },
      { path: "/Users/lostintangent/Desktop/toy-box/docs/new.md", status: "added" },
    ]);
    expect(computeFileDiffStats(fileDiffs)).toEqual({
      total: { added: 3, removed: 4 },
      byFile: [
        {
          path: "/Users/lostintangent/Desktop/toy-box/docs/notes.md",
          diff: { added: 1, removed: 1 },
        },
        {
          path: "/Users/lostintangent/Desktop/toy-box/docs/old.md",
          diff: { added: 0, removed: 3 },
        },
        {
          path: "/Users/lostintangent/Desktop/toy-box/docs/new.md",
          diff: { added: 2, removed: 0 },
        },
      ],
    });
  });

  test("counts raw diff body markers when hunk text has repeated interior context", () => {
    const fileDiffs = parsePatch(
      `diff --git a/Users/lostintangent/Desktop/toy-box/docs/repeated.md b/Users/lostintangent/Desktop/toy-box/docs/repeated.md
--- a/Users/lostintangent/Desktop/toy-box/docs/repeated.md
+++ b/Users/lostintangent/Desktop/toy-box/docs/repeated.md
@@ -1,4 +1,4 @@
 context
-same
-old
+same
+new
 tail
@@ -10,6 +10,6 @@
 top
-old one
 middle
-old two
+new one
 middle
+new two
 bottom`,
      cwd,
    );

    expect(computeFileDiffStats(fileDiffs)).toEqual({
      total: { added: 4, removed: 4 },
      byFile: [
        {
          path: "/Users/lostintangent/Desktop/toy-box/docs/repeated.md",
          diff: { added: 4, removed: 4 },
        },
      ],
    });
  });

  test("treats header-looking lines inside unified diff hunks as content", () => {
    const fileDiffs = parsePatch(
      `diff --git a/Users/lostintangent/Desktop/toy-box/docs/headings.md b/Users/lostintangent/Desktop/toy-box/docs/headings.md
--- a/Users/lostintangent/Desktop/toy-box/docs/headings.md
+++ b/Users/lostintangent/Desktop/toy-box/docs/headings.md
@@ -1 +1 @@
--- old heading
+++ new heading`,
      cwd,
    );

    expect(fileDiffs).toEqual([
      {
        path: "/Users/lostintangent/Desktop/toy-box/docs/headings.md",
        status: "modified",
        hunks: [
          {
            oldText: "-- old heading",
            newText: "++ new heading",
            lines: [
              { type: "removed", text: "-- old heading" },
              { type: "added", text: "++ new heading" },
            ],
            stats: { added: 1, removed: 1 },
          },
        ],
      },
    ]);
    expect(computeFileDiffStats(fileDiffs).total).toEqual({ added: 1, removed: 1 });
  });

  test("does not parse patch start arguments as file diffs", () => {
    const toolCall: ToolCall = {
      id: "patch-1",
      name: "patch",
      arguments: {
        patch: `*** Begin Patch
*** Delete File: /Users/lostintangent/Desktop/toy-box/docs/old.md
*** End Patch`,
      },
    };

    expect(getToolCallFileDiffs(toolCall, cwd)).toBeUndefined();
  });

  test("parses touched files from apply_patch envelopes", () => {
    const touchedFiles = parsePatchTouchedFiles(
      `*** Begin Patch
*** Add File: /Users/lostintangent/Desktop/toy-box/docs/new.md
*** Update File: /Users/lostintangent/Desktop/toy-box/docs/notes.md
*** Delete File: /Users/lostintangent/Desktop/toy-box/docs/old.md
*** End Patch`,
      cwd,
    );

    expect(touchedFiles).toEqual([
      { path: "/Users/lostintangent/Desktop/toy-box/docs/new.md", status: "added" },
      { path: "/Users/lostintangent/Desktop/toy-box/docs/notes.md", status: "modified" },
      { path: "/Users/lostintangent/Desktop/toy-box/docs/old.md", status: "deleted" },
    ]);
  });

  test("parses touched files from unified diff headers without hunk false positives", () => {
    const touchedFiles = parsePatchTouchedFiles(
      `diff --git a/docs/notes.md b/docs/notes.md
--- a/docs/notes.md
+++ b/docs/notes.md
@@ -1 +1 @@
--- not a file header
+++ not a file header
diff --git a/docs/old.md b/docs/old.md
--- a/docs/old.md
+++ /dev/null
@@ -1 +0,0 @@
-old`,
      cwd,
    );

    expect(touchedFiles).toEqual([
      { path: "docs/notes.md", status: "modified" },
      { path: "docs/old.md", status: "deleted" },
    ]);
  });

  test("parses successful patch completion details", () => {
    const toolCall: ToolCall = {
      id: "patch-1",
      name: "patch",
      arguments: {
        patch: `*** Begin Patch
*** Delete File: /Users/lostintangent/Desktop/toy-box/docs/old.md
*** End Patch`,
      },
      result: {
        content: "Deleted 1 file(s): /Users/lostintangent/Desktop/toy-box/docs/old.md",
        success: true,
        details: `diff --git a/Users/lostintangent/Desktop/toy-box/docs/old.md b/Users/lostintangent/Desktop/toy-box/docs/old.md
deleted file mode 100644
index 0000000..0000000
--- a/Users/lostintangent/Desktop/toy-box/docs/old.md
+++ /dev/null
@@ -1,2 +0,0 @@
-first
-second`,
      },
    };

    const fileDiffs = getToolCallFileDiffs(toolCall, cwd);

    expect(fileDiffs && computeFileDiffStats(fileDiffs).total).toEqual({
      added: 0,
      removed: 2,
    });
  });
});
