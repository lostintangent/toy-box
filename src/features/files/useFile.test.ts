import { expect, test } from "bun:test";
import { latestContent } from "./useFile";

test("a renderer mounted after a save starts from it until a newer external version lands", () => {
  const opened = { content: "draft", revision: 1 };
  const saved = { content: "draft, edited", revision: 1 };
  const external = { content: "agent rewrite", revision: 2 };

  expect(latestContent(opened, null)).toBe("draft");
  // A kind switch after the save mounts the next renderer on the saved text.
  expect(latestContent(opened, saved)).toBe("draft, edited");
  // A newer external version replaces the pane's older edit, and later edits win again.
  expect(latestContent(external, saved)).toBe("agent rewrite");
  expect(latestContent(external, { content: "agent rewrite, edited", revision: 2 })).toBe(
    "agent rewrite, edited",
  );
});
