import { describe, expect, test } from "bun:test";
import { sessionFile } from "@files/model";
import { createEditorPane, createSessionPane } from "@workspace/model/panes";
import { applyWorkspaceGridCountChange, resolveGridSessionOverlayId } from "./WorkspaceGrid";

function layout(rows: [number, number], top: [number, number], bottom: [number, number]) {
  return { rows, top, bottom };
}

describe("workspace grid pane-count transitions", () => {
  test("adds only the split needed for each new pane", () => {
    const twoPanes = layout([100, 0], [61.4, 38.6], [100, 0]);

    const threePanes = applyWorkspaceGridCountChange(2, 3, twoPanes);
    expect(threePanes).toEqual(layout([50, 50], [61.4, 38.6], [100, 0]));

    expect(applyWorkspaceGridCountChange(3, 4, threePanes)).toEqual(
      layout([50, 50], [61.4, 38.6], [50, 50]),
    );
  });

  test("removes panes without resetting splits that remain visible", () => {
    const fourPanes = layout([45, 55], [61.4, 38.6], [35, 65]);

    const threePanes = applyWorkspaceGridCountChange(4, 3, fourPanes);
    expect(threePanes).toEqual(layout([45, 55], [61.4, 38.6], [100, 0]));

    const twoPanes = applyWorkspaceGridCountChange(3, 2, threePanes);
    expect(twoPanes).toEqual(layout([100, 0], [61.4, 38.6], [100, 0]));

    expect(applyWorkspaceGridCountChange(2, 1, twoPanes)).toEqual(
      layout([100, 0], [100, 0], [100, 0]),
    );
  });

  test("applies intermediate transitions when the pane count jumps", () => {
    expect(applyWorkspaceGridCountChange(1, 4, layout([100, 0], [100, 0], [100, 0]))).toEqual(
      layout([50, 50], [50, 50], [50, 50]),
    );

    expect(applyWorkspaceGridCountChange(4, 1, layout([45, 55], [61.4, 38.6], [35, 65]))).toEqual(
      layout([100, 0], [100, 0], [100, 0]),
    );
  });

  test("returns the current layout when the pane count is unchanged", () => {
    const current = layout([45, 55], [61.4, 38.6], [35, 65]);
    expect(applyWorkspaceGridCountChange(4, 4, current)).toBe(current);
  });
});

describe("workspace grid session overlay", () => {
  const sessionPane = createSessionPane("session-a", false);
  const artifactPane = createEditorPane(sessionFile("session-a", "result.md"));

  test("omits the overlay while the source session is visible", () => {
    expect(resolveGridSessionOverlayId(artifactPane, [sessionPane, artifactPane], false)).toBe(
      undefined,
    );
  });

  test("shows the overlay when maximizing hides the source session", () => {
    expect(resolveGridSessionOverlayId(artifactPane, [sessionPane, artifactPane], true)).toBe(
      "session-a",
    );
  });

  test("shows the overlay when the source session pane is absent", () => {
    expect(resolveGridSessionOverlayId(artifactPane, [artifactPane], false)).toBe("session-a");
  });

  test("never overlays a session pane with itself", () => {
    expect(resolveGridSessionOverlayId(sessionPane, [sessionPane], true)).toBe(undefined);
  });
});
