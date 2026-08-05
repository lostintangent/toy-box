import { describe, expect, test } from "bun:test";
import {
  createFileRouteBaseUrl,
  createFileRouteUrl,
  getPathBasename,
  getPathDirname,
  toRelativePath,
} from "./paths";

describe("file path display", () => {
  test("reads basenames and directories across POSIX and Windows separators", () => {
    expect(getPathBasename("/repo/src/file.ts/")).toBe("file.ts");
    expect(getPathBasename(String.raw`C:\repo\src\file.ts`)).toBe("file.ts");
    expect(getPathDirname("/repo/src/file.ts")).toBe("/repo/src");
    expect(getPathDirname(String.raw`C:\repo\src\file.ts`)).toBe(String.raw`C:\repo\src`);
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
      createFileRouteUrl("/api/watch", {
        type: "session",
        sessionId: "toy box/session",
        path: String.raw`nested\file name#.md`,
      }),
    ).toBe("/api/watch/toy%20box%2Fsession/nested/file%20name%23.md");
  });

  test("routes machine files under the machine scope", () => {
    expect(createFileRouteUrl("/api/watch", { type: "machine", path: "/repo/src/foo.ts" })).toBe(
      "/api/watch/machine/repo/src/foo.ts",
    );
  });

  test("builds trailing-slash bases for root and nested artifact directories", () => {
    expect(
      createFileRouteBaseUrl("/api/serve", {
        type: "session",
        sessionId: "session",
        path: "plan.md",
      }),
    ).toBe("/api/serve/session/");
    expect(
      createFileRouteBaseUrl("/api/serve", {
        type: "session",
        sessionId: "session",
        path: "nested/charts/chart.html",
      }),
    ).toBe("/api/serve/session/nested/charts/");
  });
});
