import { describe, expect, test } from "bun:test";
import { createArtifactRouteBaseUrl, createArtifactRouteUrl } from "./paths";

describe("artifact route paths", () => {
  test("encodes session IDs and artifact path segments while preserving hierarchy", () => {
    expect(
      createArtifactRouteUrl("/api/watch", "toy box/session", String.raw`nested\file name#.md`),
    ).toBe("/api/watch/toy%20box%2Fsession/nested/file%20name%23.md");
  });

  test("builds trailing-slash bases for root and nested artifact directories", () => {
    expect(createArtifactRouteBaseUrl("/api/serve", "session", "plan.md")).toBe(
      "/api/serve/session/",
    );
    expect(createArtifactRouteBaseUrl("/api/serve", "session", "nested/charts/chart.html")).toBe(
      "/api/serve/session/nested/charts/",
    );
  });
});
