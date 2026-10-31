import { describe, expect, test } from "bun:test";
import { machineFile, sessionFile } from ".";
import { createEditorPane, resolveEditorPaneMode } from "./panes";

describe("editor panes", () => {
  test("take their identity and session from the file they edit", () => {
    expect(createEditorPane(sessionFile("A", "preview.html"))).toEqual({
      kind: "editor",
      id: "editor:session:A:preview.html",
      sessionId: "A",
      file: sessionFile("A", "preview.html"),
      title: "preview.html",
      mode: undefined,
    });
    expect(createEditorPane(machineFile("/repo/notes.md")).sessionId).toBeUndefined();
  });

  test("use product names for recognized artifact paths", () => {
    expect(createEditorPane(sessionFile("A", "plan.md")).title).toBe("Plan");
  });

  test("a user's pick outranks the mode a publisher asked for, which outranks the owner's default", () => {
    const sourceSessionId = "11111111-1111-4111-8111-111111111111";
    const pane = createEditorPane(sessionFile(sourceSessionId, "plan.md"));

    expect(resolveEditorPaneMode(pane, [sourceSessionId])).toBe("read");
    expect(resolveEditorPaneMode(pane, [])).toBe("edit");
    expect(resolveEditorPaneMode({ ...pane, mode: "edit" }, [sourceSessionId])).toBe("edit");
    expect(resolveEditorPaneMode({ ...pane, mode: "read" }, [], "shared")).toBe("shared");
  });
});
