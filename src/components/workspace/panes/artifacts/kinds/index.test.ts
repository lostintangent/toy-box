import { describe, expect, test } from "bun:test";
import type { CustomArtifactKind } from "@/types";
import { resolveArtifactKind } from "./index";
import { HtmlArtifact } from "./HtmlArtifact";
import { CustomArtifact } from "./CustomArtifact";

// The core contract of the whole feature: a registered custom kind resolves for the files
// it claims, built-ins keep priority, and unknown extensions fall back — all from the path.

const jsonTree: CustomArtifactKind = {
  name: "json-tree",
  extensions: ["json"],
  editable: true,
  html: "<html><body></body></html>",
};

describe("resolveArtifactKind", () => {
  test("resolves a registered custom kind for the files it claims, case-insensitively", () => {
    expect(resolveArtifactKind("data.json", [jsonTree])).toMatchObject({
      Renderer: CustomArtifact,
      definition: jsonTree,
      editable: true,
    });
    expect(resolveArtifactKind("DATA.JSON", [jsonTree]).definition).toBe(jsonTree);
  });

  test("normalizes custom kinds without editing support to read-only", () => {
    const readOnlyKind = { ...jsonTree, editable: undefined };

    expect(resolveArtifactKind("data.json", [readOnlyKind]).editable).toBe(false);
  });

  test("a built-in keeps priority when a custom kind claims its extension", () => {
    const rival = { ...jsonTree, name: "not-markdown", extensions: ["md"] };
    expect(resolveArtifactKind("readme.md", [rival]).definition).toBeUndefined();
  });

  test("resolves SVG artifacts to the built-in HTML pane, not a rival custom kind", () => {
    const rival = { ...jsonTree, name: "not-svg", extensions: ["svg"] };
    // Both the HTML and SVG built-ins render with the HTML pane; a custom kind can't claim `.svg`.
    expect(resolveArtifactKind("diagram.svg", []).Renderer).toBe(HtmlArtifact);
    expect(resolveArtifactKind("DIAGRAM.SVG", [rival]).Renderer).toBe(HtmlArtifact);
  });

  test("an unclaimed extension falls back to a built-in, not a registered kind", () => {
    expect(resolveArtifactKind("notes.txt", [jsonTree]).definition).toBeUndefined();
  });

  test("a file resolves to a custom kind only while it's registered", () => {
    expect(resolveArtifactKind("data.json", [jsonTree]).definition).toBe(jsonTree);
    expect(resolveArtifactKind("data.json", []).definition).toBeUndefined();
  });
});
