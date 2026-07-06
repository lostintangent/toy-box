import { describe, expect, test } from "bun:test";
import type { CustomArtifactKind } from "@/types";
import { resolveArtifactKind } from "./index";

// The core contract of the whole feature: a registered custom kind resolves for the files
// it claims, built-ins keep priority, and unknown extensions fall back — all from the path.
// `editable` is the cheapest observable that tells the resolved kinds apart (only the custom
// kind below sets it; built-ins leave it undefined), so it doubles as "which kind resolved?".

const jsonTree: CustomArtifactKind = {
  name: "json-tree",
  extensions: ["json"],
  editable: true,
  html: "<html><body></body></html>",
};

describe("resolveArtifactKind", () => {
  test("resolves a registered custom kind for the files it claims, case-insensitively", () => {
    expect(resolveArtifactKind("data.json", [jsonTree]).editable).toBe(true);
    expect(resolveArtifactKind("DATA.JSON", [jsonTree]).editable).toBe(true);
  });

  test("a built-in keeps priority when a custom kind claims its extension", () => {
    const rival = { ...jsonTree, name: "not-markdown", extensions: ["md"] };
    // Markdown (a built-in, no `editable`) still wins `.md` over the editable custom kind.
    expect(resolveArtifactKind("readme.md", [rival]).editable).toBeUndefined();
  });

  test("an unclaimed extension falls back to a built-in, not a registered kind", () => {
    expect(resolveArtifactKind("notes.txt", [jsonTree]).editable).toBeUndefined();
  });

  test("a file resolves to a custom kind only while it's registered", () => {
    expect(resolveArtifactKind("data.json", [jsonTree]).editable).toBe(true);
    expect(resolveArtifactKind("data.json", []).editable).toBeUndefined();
  });
});
