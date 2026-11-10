import { describe, expect, test } from "bun:test";
import type { AppDefinition } from "@apps/model";
import { machineFile, sessionFile } from "@files/model";
import { resolveEditorKind } from "./index";

// The core contract of the whole feature: an installed app definition opens the files it claims,
// built-ins keep priority, and unknown extensions fall back — all from the path.

const definition = (id: string, opens: string[]): AppDefinition => ({
  id,
  title: id,
  color: "#f59e0b",
  state: { schema: { type: "object" }, default: {} },
  accepts: [],
  opens,
  revision: `${id}-a`,
});
const httpClient = definition("http-client", ["http", "rest"]);
const machine = (name: string) => machineFile(`/repo/${name}`);
const markdown = resolveEditorKind(machine("notes.md"), []);

describe("resolveEditorKind", () => {
  test("an installed definition opens the files it claims, case-insensitively", () => {
    const kind = resolveEditorKind(machine("api.http"), [httpClient]);

    expect(kind.extensions).toEqual(["http", "rest"]);
    expect(kind.Renderer).not.toBe(markdown.Renderer);
    expect(resolveEditorKind(machine("API.REST"), [httpClient]).Renderer).toBe(kind.Renderer);
  });

  test("the first definition in catalog order wins a shared extension", () => {
    const first = definition("first", ["http"]);

    expect(resolveEditorKind(machine("api.http"), [first, httpClient]).extensions).toEqual([
      "http",
    ]);
  });

  test("a new definition revision is a new kind, so open panes remount it from their latest text", () => {
    const file = machine("api.http");
    const revised = { ...httpClient, revision: "http-client-b" };

    expect(resolveEditorKind(file, [revised]).id).not.toBe(
      resolveEditorKind(file, [httpClient]).id,
    );
  });

  test.each(["md", "html", "svg", "json", "brief"])(
    "the built-in .%s editor beats a rival definition, case-insensitively",
    (extension) => {
      const builtIn = resolveEditorKind(machine(`file.${extension}`), []);
      const rival = definition(`not-${extension}`, [extension]);

      expect(builtIn.extensions).toContain(extension);
      expect(resolveEditorKind(machine(`FILE.${extension.toUpperCase()}`), [rival])).toBe(builtIn);
    },
  );

  test("an unclaimed extension falls back to Markdown", () => {
    expect(resolveEditorKind(machine("notes.txt"), [httpClient])).toBe(markdown);
    expect(resolveEditorKind(machine("Makefile"), [httpClient])).toBe(markdown);
  });

  test("runs .toy files only when they belong to a session", () => {
    const sessionKind = resolveEditorKind(sessionFile("session-a", "board.toy"), []);
    const machineKind = resolveEditorKind(machine("board.toy"), []);

    expect(sessionKind).toMatchObject({ extensions: ["toy"], editable: false });
    expect(machineKind.Renderer).not.toBe(sessionKind.Renderer);
  });
});
