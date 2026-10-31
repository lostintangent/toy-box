import { describe, expect, test } from "bun:test";
import type { CustomEditorKind } from "@files/model";
import { resolveEditorKind } from "./index";
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

  test.each(["md", "svg", "json", "brief"])(
    "the built-in .%s editor beats a rival custom kind, case-insensitively",
    (extension) => {
      const rival = { ...csvTable, name: `not-${extension}`, extensions: [extension] };
      const builtIn = resolveEditorKind(machine(`file.${extension}`), []);
      const contested = resolveEditorKind(machine(`FILE.${extension.toUpperCase()}`), [rival]);

      expect(builtIn.extensions).toContain(extension);
      expect(builtIn.definition).toBeUndefined();
      expect(contested.Renderer).toBe(builtIn.Renderer);
    },
  );

  test("an unclaimed extension falls back to a built-in, not a registered kind", () => {
    expect(resolveEditorKind(machine("notes.txt"), [csvTable]).definition).toBeUndefined();
  });

  test("runs .toy files only when they belong to a session", () => {
    const sessionKind = resolveEditorKind(sessionFile("session-a", "board.toy"), []);
    const machineKind = resolveEditorKind(machine("board.toy"), []);

    expect(sessionKind).toMatchObject({ extensions: ["toy"], editable: false });
    expect(machineKind.Renderer).not.toBe(sessionKind.Renderer);
  });
});
