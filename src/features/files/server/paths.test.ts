import { homedir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, onTestFinished, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { listSessionArtifacts, deleteSessionFiles } from "@sessions/server/artifacts";
import {
  projectSessionArtifactPath,
  resolveSessionArtifactPath,
  resolveWorkspaceFile,
  workspaceFileFromAbsolutePath,
  sessionArtifactDirectory,
} from "./paths";

describe("artifact paths", () => {
  test("owned artifacts and attachments share one deletion lifecycle", async () => {
    const id = `toy-box-test-${crypto.randomUUID()}`;
    const directory = sessionArtifactDirectory(id)!;
    const attachments = resolve(directory, "../attachments/input.txt");
    onTestFinished(() => rm(resolve(directory, ".."), { recursive: true, force: true }));
    await mkdir(directory, { recursive: true });
    await Bun.write(resolve(directory, "report.md"), "Report");
    await Bun.write(attachments, "Input");
    expect(await Bun.file(resolveSessionArtifactPath(id, "report.md")!).text()).toBe("Report");
    expect(await listSessionArtifacts(id)).toEqual([
      { path: "report.md", updatedAt: expect.any(Number) },
    ]);
    await deleteSessionFiles(id);
    expect(await listSessionArtifacts(id)).toEqual([]);
    expect(await Bun.file(attachments).exists()).toBe(false);
  });
  describe("session artifacts", () => {
    test("resolves artifact-relative paths inside the session artifacts folder", () => {
      expect(resolveSessionArtifactPath("toy-box-session", "report.md")).toBe(
        resolve(homedir(), ".toy-box/sessions/toy-box-session/artifacts/report.md"),
      );
    });

    test("rejects paths outside the session artifacts folder", () => {
      expect(resolveSessionArtifactPath("toy-box-session", "../workspace.yaml")).toBe(null);
      expect(resolveSessionArtifactPath("toy-box-session", "/etc/passwd")).toBe(null);
      expect(
        resolveSessionArtifactPath(
          "toy-box-session",
          "~/.toy-box/sessions/other-session/artifacts/report.md",
        ),
      ).toBe(null);
    });

    test("rejects explicit filesystem-shaped artifact paths", () => {
      expect(
        resolveSessionArtifactPath(
          "toy-box-session",
          "~/.toy-box/sessions/toy-box-session/artifacts/report.md",
        ),
      ).toBe(null);
      expect(
        resolveSessionArtifactPath(
          "toy-box-session",
          ".toy-box/sessions/toy-box-session/artifacts/report.md",
        ),
      ).toBe(null);
    });

    test("rejects session IDs that escape the session state root", () => {
      expect(resolveSessionArtifactPath("../outside", "report.md")).toBe(null);
    });
  });

  describe("projected session artifact paths", () => {
    test("projects explicit SDK paths inside the same session artifacts folder", () => {
      expect(
        projectSessionArtifactPath(
          "toy-box-session",
          resolve(homedir(), ".toy-box/sessions/toy-box-session/artifacts/report.md"),
        ),
      ).toBe("report.md");
    });

    test("rejects root session-state files and other sessions", () => {
      expect(
        projectSessionArtifactPath(
          "toy-box-session",
          resolve(homedir(), ".toy-box/sessions/toy-box-session/report.md"),
        ),
      ).toBeUndefined();
      expect(
        projectSessionArtifactPath(
          "toy-box-session",
          resolve(homedir(), ".toy-box/sessions/other-session/artifacts/report.md"),
        ),
      ).toBeUndefined();
    });

    test("rejects non-explicit working-directory relative paths", () => {
      expect(projectSessionArtifactPath("toy-box-session", "files/report.md")).toBeUndefined();
      expect(projectSessionArtifactPath("toy-box-session", "/tmp/report.md")).toBeUndefined();
    });
  });

  describe("workspace files", () => {
    test("classifies absolute Session artifacts without losing their owner", () => {
      expect(
        workspaceFileFromAbsolutePath(
          resolve(homedir(), ".toy-box/sessions/toy-box-session/artifacts/nested/report.md"),
        ),
      ).toEqual({
        kind: "session",
        sessionId: "toy-box-session",
        path: "nested/report.md",
      });
      expect(workspaceFileFromAbsolutePath("/repo/src/foo.ts")).toEqual({
        kind: "machine",
        path: "/repo/src/foo.ts",
      });
    });

    test("resolves a session file under its session artifacts folder", () => {
      expect(
        resolveWorkspaceFile({ kind: "session", sessionId: "toy-box-session", path: "report.md" }),
      ).toBe(resolve(homedir(), ".toy-box/sessions/toy-box-session/artifacts/report.md"));
    });

    test("resolves a machine file to its own absolute path and rejects relative paths", () => {
      expect(resolveWorkspaceFile({ kind: "machine", path: "/repo/src/foo.ts" })).toBe(
        "/repo/src/foo.ts",
      );
      expect(resolveWorkspaceFile({ kind: "machine", path: "repo/src/foo.ts" })).toBeNull();
    });
  });
});
