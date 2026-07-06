import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { projectSessionArtifactPath, resolveSessionArtifactPath } from "./sandbox";

describe("sandbox", () => {
  describe("session artifacts", () => {
    test("resolves artifact-relative paths inside the session files folder", () => {
      expect(resolveSessionArtifactPath("toy-box-session", "report.md")).toEqual({
        path: "report.md",
        absolutePath: resolve(homedir(), ".copilot/session-state/toy-box-session/files/report.md"),
      });
    });

    test("rejects paths outside the session files folder", () => {
      expect(resolveSessionArtifactPath("toy-box-session", "../workspace.yaml")).toBe(null);
      expect(resolveSessionArtifactPath("toy-box-session", "/etc/passwd")).toBe(null);
      expect(
        resolveSessionArtifactPath(
          "toy-box-session",
          "~/.copilot/session-state/other-session/files/report.md",
        ),
      ).toBe(null);
    });

    test("rejects explicit filesystem-shaped artifact paths", () => {
      expect(
        resolveSessionArtifactPath(
          "toy-box-session",
          "~/.copilot/session-state/toy-box-session/files/report.md",
        ),
      ).toBe(null);
      expect(
        resolveSessionArtifactPath(
          "toy-box-session",
          ".copilot/session-state/toy-box-session/files/report.md",
        ),
      ).toBe(null);
    });

    test("rejects session IDs that escape the session state root", () => {
      expect(resolveSessionArtifactPath("../outside", "report.md")).toBe(null);
    });
  });

  describe("projected session artifact paths", () => {
    test("projects explicit SDK paths inside the same session files folder", () => {
      expect(
        projectSessionArtifactPath(
          "toy-box-session",
          resolve(homedir(), ".copilot/session-state/toy-box-session/files/report.md"),
        ),
      ).toBe("report.md");
    });

    test("rejects root session-state files and other sessions", () => {
      expect(
        projectSessionArtifactPath(
          "toy-box-session",
          resolve(homedir(), ".copilot/session-state/toy-box-session/report.md"),
        ),
      ).toBeUndefined();
      expect(
        projectSessionArtifactPath(
          "toy-box-session",
          resolve(homedir(), ".copilot/session-state/other-session/files/report.md"),
        ),
      ).toBeUndefined();
    });

    test("rejects non-explicit working-directory relative paths", () => {
      expect(projectSessionArtifactPath("toy-box-session", "files/report.md")).toBeUndefined();
      expect(projectSessionArtifactPath("toy-box-session", "/tmp/report.md")).toBeUndefined();
    });
  });
});
