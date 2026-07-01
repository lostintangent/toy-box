import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { resolveSessionArtifactPath, resolveSessionStatePath } from "./sandbox";

describe("sandbox", () => {
  describe("session artifacts", () => {
    test("resolves artifact paths relative to the session state folder", () => {
      expect(resolveSessionArtifactPath("toy-box-session", "files/report.md")).toBe(
        resolve(homedir(), ".copilot/session-state/toy-box-session/files/report.md"),
      );
    });

    test("accepts existing artifact paths already rooted in the session state folder", () => {
      expect(
        resolveSessionArtifactPath(
          "toy-box-session",
          "~/.copilot/session-state/toy-box-session/files/report.md",
        ),
      ).toBe(resolve(homedir(), ".copilot/session-state/toy-box-session/files/report.md"));
    });

    test("rejects artifact paths that escape the session folder", () => {
      expect(
        resolveSessionArtifactPath("toy-box-session", "../other-session/files/report.md"),
      ).toBe(null);
      expect(resolveSessionArtifactPath("toy-box-session", "/etc/passwd")).toBe(null);
      expect(
        resolveSessionArtifactPath(
          "toy-box-session",
          "~/.copilot/session-state/other-session/files/report.md",
        ),
      ).toBe(null);
    });

    test("rejects session IDs that escape the session state root", () => {
      expect(resolveSessionArtifactPath("../outside", "files/report.md")).toBe(null);
    });
  });

  describe("session state paths", () => {
    test("reads paths inside the session state root", () => {
      expect(resolveSessionStatePath("~/.copilot/session-state/toy-box-session/report.md")).toBe(
        "~/.copilot/session-state/toy-box-session/report.md",
      );
    });

    test("rejects paths outside the session state root", () => {
      expect(resolveSessionStatePath("/tmp/report.md")).toBeUndefined();
    });
  });
});
