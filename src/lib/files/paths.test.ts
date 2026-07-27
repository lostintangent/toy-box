import { describe, expect, test } from "bun:test";
import { createFileRouteBaseUrl, createFileRouteUrl } from "./paths";

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
