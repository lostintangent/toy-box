import { describe, expect, test } from "bun:test";
import type { CustomEditorKind } from "@files/model";
import { resolveEditorKind } from "./index";
import { HtmlEditor } from "./html/HtmlEditor";
import { CustomEditor } from "./custom/CustomEditor";
import { machineFile, sessionFile } from "@files/model";

// The core contract of the whole feature: a registered custom kind resolves for the files
// it claims, built-ins keep priority, and unknown extensions fall back — all from the path.

const csvTable: CustomEditorKind = {
  name: "csv-table",
  extensions: ["csv"],
  editable: true,
  html: "<html><body></body></html>",
};

const machine = (name: string) => machineFile(`/repo/${name}`);

describe("resolveEditorKind", () => {
  test("resolves a registered custom kind for the files it claims, case-insensitively", () => {
    expect(resolveEditorKind(machine("data.csv"), [csvTable])).toMatchObject({
      Renderer: CustomEditor,
      definition: csvTable,
      editable: true,
    });
    expect(resolveEditorKind(machine("DATA.CSV"), [csvTable]).definition).toBe(csvTable);
  });

  test("normalizes custom kinds without editing support to read-only", () => {
    const readOnlyKind = { ...csvTable, editable: undefined };

    expect(resolveEditorKind(machine("data.csv"), [readOnlyKind]).editable).toBe(false);
  });

  test("a built-in keeps priority when a custom kind claims its extension", () => {
    const rival = { ...csvTable, name: "not-markdown", extensions: ["md"] };
    expect(resolveEditorKind(machine("readme.md"), [rival]).definition).toBeUndefined();
  });

  test("resolves SVG artifacts to the drawing pane, not HTML or a rival custom kind", () => {
    const rival = { ...csvTable, name: "not-svg", extensions: ["svg"] };
    const kind = resolveEditorKind(machine("diagram.svg"), []);

    expect(kind).toMatchObject({
      extensions: ["svg"],
    });
    expect(kind.Renderer).not.toBe(HtmlEditor);
    expect(kind.definition).toBeUndefined();
    expect(resolveEditorKind(machine("DIAGRAM.SVG"), [rival]).Renderer).toBe(kind.Renderer);
  });

  test("resolves JSON artifacts to the built-in tree editor, beating a rival custom kind", () => {
    const rival = { ...csvTable, name: "not-json", extensions: ["json"] };
    const kind = resolveEditorKind(machine("data.json"), [rival]);

    expect(kind).toMatchObject({ extensions: ["json"] });
    expect(kind.definition).toBeUndefined();
    expect(resolveEditorKind(machine("DATA.JSON"), [rival]).Renderer).toBe(kind.Renderer);
  });

  test("an unclaimed extension falls back to a built-in, not a registered kind", () => {
    expect(resolveEditorKind(machine("notes.txt"), [csvTable]).definition).toBeUndefined();
  });

  test("a file resolves to a custom kind only while it's registered", () => {
    expect(resolveEditorKind(machine("data.csv"), [csvTable]).definition).toBe(csvTable);
    expect(resolveEditorKind(machine("data.csv"), []).definition).toBeUndefined();
  });

  test("runs .toy files only when they belong to a session", () => {
    const sessionKind = resolveEditorKind(sessionFile("session-a", "board.toy"), []);
    const machineKind = resolveEditorKind(machine("board.toy"), []);

    expect(sessionKind).toMatchObject({ extensions: ["toy"], editable: false });
    expect(machineKind.Renderer).not.toBe(sessionKind.Renderer);
  });
});
