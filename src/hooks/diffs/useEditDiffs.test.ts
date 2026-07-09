import { describe, expect, test } from "bun:test";
import type { Message } from "@/types";
import { computeSessionDiffs } from "./useEditDiffs";

const cwd = "/Users/lostintangent/Desktop/toy-box";

describe("computeSessionDiffs", () => {
  test("summarizes successful edit and patch file diffs", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "failed-edit",
            name: "edit",
            arguments: {
              path: "/Users/lostintangent/Desktop/toy-box/docs/failed.md",
              old_str: "before",
              new_str: "after",
            },
            result: {
              content: "failed",
              success: false,
            },
          },
          {
            id: "edit-1",
            name: "edit",
            arguments: {
              path: "/Users/lostintangent/Desktop/toy-box/docs/edit.md",
              old_str: "one\ntwo",
              new_str: "one\nthree\nfour",
            },
            result: {
              content: "ok",
              success: true,
            },
          },
          {
            id: "patch-1",
            name: "patch",
            arguments: {
              patch: `*** Begin Patch
*** Delete File: /Users/lostintangent/Desktop/toy-box/docs/old.md
*** End Patch`,
            },
            result: {
              content: "Deleted 1 file(s), added 1 file(s)",
              success: true,
              details: `diff --git a/Users/lostintangent/Desktop/toy-box/docs/old.md b/Users/lostintangent/Desktop/toy-box/docs/old.md
--- a/Users/lostintangent/Desktop/toy-box/docs/old.md
+++ /dev/null
@@ -1 +0,0 @@
-old
diff --git a/Users/lostintangent/Desktop/toy-box/docs/new.md b/Users/lostintangent/Desktop/toy-box/docs/new.md
--- /dev/null
+++ b/Users/lostintangent/Desktop/toy-box/docs/new.md
@@ -0,0 +1,2 @@
+new
+file`,
            },
          },
        ],
      },
    ];

    const diffs = computeSessionDiffs(messages, cwd);

    expect(diffs.total).toEqual({ added: 4, removed: 2 });
    expect(diffs.byToolCallId).toEqual(
      new Map([
        ["edit-1", { added: 2, removed: 1 }],
        ["patch-1", { added: 2, removed: 1 }],
      ]),
    );
    expect(diffs.byFile).toEqual([
      {
        path: "/Users/lostintangent/Desktop/toy-box/docs/edit.md",
        displayPath: "docs/edit.md",
        diff: { added: 2, removed: 1 },
      },
      {
        path: "/Users/lostintangent/Desktop/toy-box/docs/old.md",
        displayPath: "docs/old.md",
        diff: { added: 0, removed: 1 },
      },
      {
        path: "/Users/lostintangent/Desktop/toy-box/docs/new.md",
        displayPath: "docs/new.md",
        diff: { added: 2, removed: 0 },
      },
    ]);
  });
});
