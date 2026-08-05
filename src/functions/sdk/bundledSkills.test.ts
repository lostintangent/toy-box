import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import appRuntimeReference from "./skills/create-toy-box-app/references/runtime.md?raw";
import appAuthoringSkill from "./skills/create-toy-box-app/SKILL.md?raw";
import editorRuntimeReference from "./skills/create-toy-box-editor/references/runtime.md?raw";
import editorAuthoringSkill from "./skills/create-toy-box-editor/SKILL.md?raw";
import squadSkill from "./skills/run-squad/SKILL.md?raw";
import { getSessionSkillDirectories, installBundledSkills } from "./bundledSkills";

const temporaryRoots: string[] = [];
const bundledFiles = {
  "./skills/create-toy-box-app/SKILL.md": appAuthoringSkill,
  "./skills/create-toy-box-app/references/runtime.md": appRuntimeReference,
  "./skills/create-toy-box-editor/SKILL.md": editorAuthoringSkill,
  "./skills/create-toy-box-editor/references/runtime.md": editorRuntimeReference,
  "./skills/run-squad/SKILL.md": squadSkill,
  "./skills/example-skill/SKILL.md": "---\nname: example-skill\ndescription: Test skill.\n---\n",
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bundled SDK skills", () => {
  test("materializes every bundled skill and exposes only role-owned directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "toy-box-skills-"));
    temporaryRoots.push(root);

    const standardDirectories = getSessionSkillDirectories("standard", root);
    expect(standardDirectories).toEqual([join(root, "run-squad")]);
    expect(getSessionSkillDirectories("worker", root)).toBeUndefined();

    const staleReference = join(root, "create-toy-box-app", "references", "sdk.md");
    await mkdir(join(root, "create-toy-box-app", "references"), { recursive: true });
    await writeFile(staleReference, "stale");
    await installBundledSkills(root, bundledFiles);
    expect(readFile(staleReference, "utf-8")).rejects.toThrow();
    expect(await readFile(join(root, "example-skill", "SKILL.md"), "utf-8")).toContain(
      "name: example-skill",
    );

    const directories = getSessionSkillDirectories("hyper", root);
    expect(directories).toEqual([
      join(root, "run-squad"),
      join(root, "create-toy-box-app"),
      join(root, "create-toy-box-editor"),
    ]);

    const installedSquadSkill = await readFile(join(standardDirectories![0]!, "SKILL.md"), "utf-8");
    expect(installedSquadSkill).toContain("name: run-squad");
    expect(installedSquadSkill).toContain("`create_session`");
    expect(installedSquadSkill).toContain("`create_worker_session`");
    expect(installedSquadSkill).toContain("`wait_for_sessions`");
    expect(installedSquadSkill).toContain("`deliver_message`");
    expect(installedSquadSkill).toContain("only in\n   its session's current working directory");
    expect(installedSquadSkill).toContain("changed destination HEAD or status");
    expect(installedSquadSkill).toContain("SQUAD_IMPLEMENTATION");
    expect(installedSquadSkill).toContain("SQUAD_REVIEW");
    expect(installedSquadSkill).not.toContain("update_app");

    const appSkill = await readFile(join(directories![1]!, "SKILL.md"), "utf-8");
    const appReference = await readFile(
      join(directories![1]!, "references", "runtime.md"),
      "utf-8",
    );
    expect(appSkill).toContain("name: create-toy-box-app");
    expect(appSkill).toContain("single-file React component");
    expect(appSkill).toContain("workspace sessions, files, and panes");
    expect(appSkill).toContain("The **design system**");
    expect(appSkill).toContain("The **SDK**");
    expect(appSkill).toContain('"icon": "Feather"');
    expect(appSkill).toContain('"color": "#8b5cf6"');
    expect(appSkill).toContain("Supported icons");
    expect(appSkill).toContain("references/runtime.md");
    expect(appSkill).toContain("update_app");
    expect(appReference).toContain("## Available Libraries");
    expect(appReference).toContain("## Design System");
    expect(appReference).toContain("## SDK APIs");
    expect(appReference).toContain("input: SessionLaunch & {");
    expect(appReference).toContain("ephemeral?: boolean;");
    expect(appReference).toContain("AppEmptyState");
    expect(appReference).toContain("AppFilePicker");
    expect(appReference).toContain("AppLocationPicker");
    expect(appReference).toContain("useFile(file, mode)");
    expect(appReference).toContain("Set `ephemeral: false`");
    expect(appReference).toContain("`zod` for app-local parsing");
    expect(appReference).toContain("useApp()");
    expect(appReference).toContain("fully typed without a TS interface or local validator");
    expect(appReference).not.toContain("useApp(StateSchema)");
    expect(appReference).not.toContain("useAppState");
    expect(appReference).not.toContain("useAppActions");
    expect(appReference).toContain("file-owned worker");
    expect(appReference).toContain("waitForSession");
    expect(appReference).not.toContain("waitForWorker");
    expect(appReference).toContain("owner-scoped tools");
    expect(appReference).toContain("already scoped to the");
    expect(appReference).toContain("global summary catalog");
    expect(appReference).toContain("React Compiler runs during registration");
    expect(appReference).toContain("useReducer");
    expect(appReference).not.toContain("@tanstack/store");
    expect(appReference).not.toContain("@tanstack/react-store");

    const editorSkill = await readFile(join(directories![2]!, "SKILL.md"), "utf-8");
    const editorReference = await readFile(
      join(directories![2]!, "references", "runtime.md"),
      "utf-8",
    );
    expect(editorSkill).toContain("name: create-toy-box-editor");
    expect(editorSkill).toContain("sandboxed iframe");
    expect(editorSkill).toContain("`register_editor`");
    expect(editorSkill).toContain("references/runtime.md");
    expect(editorSkill).toContain("registration is the writer and activation boundary");
    expect(editorReference).toContain("## Document Contract");
    expect(editorReference).toContain("## Host API");
    expect(editorReference).toContain("`revision` identifies the latest external file content");
    expect(editorReference).toContain("Toybox.emitChange(nextContent)");
    expect(editorReference).toContain("Toybox.spawnWorker");
  });
});
