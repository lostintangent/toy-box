import { describe, expect, test } from "bun:test";
import {
  createFileServeBaseUrl,
  createFileServeUrl,
  createFileWatchUrl,
  fileName,
  getPathBasename,
  getPathDirname,
  rankFilePaths,
  toRelativePath,
} from "./paths";

describe("file path display", () => {
  test("reads basenames and directories across POSIX and Windows separators", () => {
    expect(getPathBasename("/repo/src/file.ts/")).toBe("file.ts");
    expect(getPathBasename(String.raw`C:\repo\src\file.ts`)).toBe("file.ts");
    expect(getPathDirname("/repo/src/file.ts")).toBe("/repo/src");
    expect(getPathDirname(String.raw`C:\repo\src\file.ts`)).toBe(String.raw`C:\repo\src`);
    expect(fileName("/repo/plan.md")).toBe("Plan");
  });

  test("collapses paths beneath the working or home directory", () => {
    expect(toRelativePath("/repo/src/file.ts", "/repo")).toBe("src/file.ts");
    expect(toRelativePath("/repo", "/repo")).toBe(".");
    expect(toRelativePath("/Users/person/project/file.ts")).toBe("~/project/file.ts");
  });
});

describe("artifact route paths", () => {
  test("encodes session IDs and artifact path segments while preserving hierarchy", () => {
    expect(
      createFileWatchUrl({
        kind: "session",
        sessionId: "toy box/session",
        path: String.raw`nested\file name#.md`,
      }),
    ).toBe("/api/watch/toy%20box%2Fsession/nested/file%20name%23.md");
  });

  test("routes machine files under the machine scope", () => {
    expect(createFileServeUrl({ kind: "machine", path: "/repo/src/foo.ts" })).toBe(
      "/api/serve/machine/repo/src/foo.ts",
    );
  });

  test("builds trailing-slash bases for root and nested artifact directories", () => {
    expect(
      createFileServeBaseUrl({
        kind: "session",
        sessionId: "session",
        path: "plan.md",
      }),
    ).toBe("/api/serve/session/");
    expect(
      createFileServeBaseUrl({
        kind: "session",
        sessionId: "session",
        path: "nested/charts/chart.html",
      }),
    ).toBe("/api/serve/session/nested/charts/");
  });
});

describe("rankFilePaths", () => {
  const paths = [
    "src/features/sessions/components/composer/SessionComposer.tsx",
    "src/composer.ts",
    "docs/composer-notes.md",
    "src/features/files/model/paths.ts",
  ];

  test("prefers basename prefixes, then basename matches, then path matches", () => {
    expect(rankFilePaths(paths, "composer", 10)).toEqual([
      "src/composer.ts",
      "docs/composer-notes.md",
      "src/features/sessions/components/composer/SessionComposer.tsx",
    ]);
    expect(rankFilePaths(paths, "SESSIONS/", 10)).toEqual([
      "src/features/sessions/components/composer/SessionComposer.tsx",
    ]);
  });

  test("an empty query favors the shortest paths, within the limit", () => {
    expect(rankFilePaths(paths, "", 2)).toEqual(["src/composer.ts", "docs/composer-notes.md"]);
  });
});
