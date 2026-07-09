import { describe, expect, test } from "bun:test";
import { INBOX_PANE, createArtifactPane } from "@/lib/workspace/panes";
import { updateArtifactPaneMode } from "./useLinkedPanes";

describe("linked pane layout", () => {
  test("updates an artifact published by a pane other than its source session", () => {
    const artifactPane = createArtifactPane("inbox-1", "result.md", "edit");
    const current = { [INBOX_PANE.id]: [artifactPane] };

    expect(updateArtifactPaneMode(current, artifactPane, "shared")).toEqual({
      [INBOX_PANE.id]: [{ ...artifactPane, mode: "shared" }],
    });
  });

  test("preserves identity when the requested mode is already active", () => {
    const artifactPane = createArtifactPane("inbox-1", "result.md", "edit");
    const current = { [INBOX_PANE.id]: [artifactPane] };

    expect(updateArtifactPaneMode(current, artifactPane, "edit")).toBe(current);
  });
});
