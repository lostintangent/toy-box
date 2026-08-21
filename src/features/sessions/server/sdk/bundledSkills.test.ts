import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import appRuntimeReference from "@apps/server/skills/create-toy-box-app/references/runtime.md?raw";
import appAuthoringSkill from "@apps/server/skills/create-toy-box-app/SKILL.md?raw";
import editorRuntimeReference from "@files/server/skills/create-toy-box-editor/references/runtime.md?raw";
import editorAuthoringSkill from "@files/server/skills/create-toy-box-editor/SKILL.md?raw";
import intentExample from "@files/server/skills/create-toy-box-intent/references/example.intent?raw";
import intentSchemaReference from "@files/server/skills/create-toy-box-intent/references/schema.md?raw";
import intentAuthoringSkill from "@files/server/skills/create-toy-box-intent/SKILL.md?raw";
import type { SessionType } from "@sessions/model";
import { getSessionSkillDirectories, installBundledSkills } from "./bundledSkills";

const temporaryRoots: string[] = [];
const bundledFiles = {
  "../../features/apps/server/skills/create-toy-box-app/SKILL.md": appAuthoringSkill,
  "../../features/apps/server/skills/create-toy-box-app/references/runtime.md": appRuntimeReference,
  "../../features/files/server/skills/create-toy-box-editor/SKILL.md": editorAuthoringSkill,
  "../../features/files/server/skills/create-toy-box-editor/references/runtime.md":
    editorRuntimeReference,
  "../../features/files/server/skills/create-toy-box-intent/SKILL.md": intentAuthoringSkill,
  "../../features/files/server/skills/create-toy-box-intent/references/schema.md":
    intentSchemaReference,
  "../../features/files/server/skills/create-toy-box-intent/references/example.intent":
    intentExample,
  "../../features/example/server/skills/example-skill/SKILL.md":
    "---\nname: example-skill\ndescription: Test skill.\n---\n",
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bundled SDK skills", () => {
  test("materializes every bundled skill and exposes universal plus role-owned directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "toy-box-skills-"));
    temporaryRoots.push(root);

    for (const sessionType of [
      "standard",
      "automation",
      "inbox",
      "hyper",
      "worker",
    ] satisfies SessionType[]) {
      expect(getSessionSkillDirectories(sessionType, root)).toEqual([
        join(root, "create-toy-box-app"),
        join(root, "create-toy-box-intent"),
        ...(sessionType === "hyper" ? [join(root, "create-toy-box-editor")] : []),
      ]);
    }

    const staleReference = join(root, "create-toy-box-app", "references", "sdk.md");
    await mkdir(join(root, "create-toy-box-app", "references"), { recursive: true });
    await writeFile(staleReference, "stale");
    await installBundledSkills(bundledFiles, root);
    expect(readFile(staleReference, "utf-8")).rejects.toThrow();
    expect(await readFile(join(root, "example-skill", "SKILL.md"), "utf-8")).toContain(
      "name: example-skill",
    );
    const intentSkill = await readFile(join(root, "create-toy-box-intent", "SKILL.md"), "utf-8");
    expect(intentSkill).toContain("name: create-toy-box-intent");
    expect(intentSkill).toContain("`start-work`");
    expect(intentSkill).not.toContain("`plan-implementation`");
    expect(
      await readFile(join(root, "create-toy-box-intent", "references", "schema.md"), "utf-8"),
    ).toContain("The `.intent` format");
    const intentExample = await readFile(
      join(root, "create-toy-box-intent", "references", "example.intent"),
      "utf-8",
    );
    expect(intentExample).toContain('"title": "Let ordinary tools share message bodies"');
    expect(intentExample).not.toContain('"version"');

    const appDirectory = join(root, "create-toy-box-app");
    const appSkill = await readFile(join(appDirectory, "SKILL.md"), "utf-8");
    const appReference = await readFile(join(appDirectory, "references", "runtime.md"), "utf-8");
    expect(appSkill).toContain("name: create-toy-box-app");
    expect(appSkill).toContain("Artifact App");
    expect(appSkill).toContain("`.toy`");
    expect(appSkill).toContain("validate_artifact_app");
    expect(appSkill).toContain("Promote");
    expect(appSkill).toContain("Never call `open_file` for");
    expect(appSkill).toContain("invoke repository code-review skills");
    expect(appSkill).toContain("complete code-quality gates");
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
    expect(appReference).toContain("useAppActions()");
    expect(appReference).toContain("fully typed without a TS interface or local validator");
    expect(appReference).not.toContain("useApp(StateSchema)");
    expect(appReference).not.toContain("useAppState");
    expect(appReference).toContain("file-owned worker");
    expect(appReference).toContain("waitForSession");
    expect(appReference).not.toContain("waitForWorker");
    expect(appReference).toContain("owner-scoped tools");
    expect(appReference).toContain("already scoped to the");
    expect(appReference).toContain("global summary catalog");
    expect(appReference).toContain(
      "React Compiler runs during artifact validation and installed-app registration",
    );
    expect(appReference).toContain("useReducer");
    expect(appReference).not.toContain("@tanstack/store");
    expect(appReference).not.toContain("@tanstack/react-store");

    const editorDirectory = join(root, "create-toy-box-editor");
    const editorSkill = await readFile(join(editorDirectory, "SKILL.md"), "utf-8");
    const editorReference = await readFile(
      join(editorDirectory, "references", "runtime.md"),
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
