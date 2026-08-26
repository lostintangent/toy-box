import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionType } from "@sessions/model";
import { getSessionSkillDirectories, installBundledSkills } from "./bundledSkills";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("bundled SDK skills", () => {
  test("replaces bundled skill directories without touching user-owned skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "toy-box-skills-"));
    temporaryRoots.push(root);

    const staleReference = join(root, "first-skill", "references", "stale.md");
    const userSkill = join(root, "user-skill", "SKILL.md");
    await mkdir(join(root, "first-skill", "references"), { recursive: true });
    await mkdir(join(root, "user-skill"), { recursive: true });
    await writeFile(staleReference, "stale");
    await writeFile(userSkill, "user owned");

    await installBundledSkills(
      {
        "../../features/example/server/skills/first-skill/SKILL.md": "first",
        "../../features/example/server/skills/first-skill/references/contract.md": "contract",
        "../../features/example/server/skills/second-skill/SKILL.md": "second",
      },
      root,
    );

    expect(readFile(staleReference, "utf-8")).rejects.toThrow();
    expect(await readFile(join(root, "first-skill", "SKILL.md"), "utf-8")).toBe("first");
    expect(await readFile(join(root, "first-skill", "references", "contract.md"), "utf-8")).toBe(
      "contract",
    );
    expect(await readFile(join(root, "second-skill", "SKILL.md"), "utf-8")).toBe("second");
    expect(await readFile(userSkill, "utf-8")).toBe("user owned");
  });

  test("exposes universal skills to every session and editor authoring only to Hyper", () => {
    const root = "/skills";
    const universal = ["create-toy-box-app", "create-toy-box-intent", "execute-toy-box-intent"];
    const expected = {
      standard: universal,
      automation: universal,
      inbox: universal,
      worker: universal,
      hyper: [...universal, "create-toy-box-editor"],
    } satisfies Record<SessionType, readonly string[]>;

    for (const [sessionType, skillNames] of Object.entries(expected)) {
      expect(getSessionSkillDirectories(sessionType as SessionType, root)).toEqual(
        skillNames.map((name) => join(root, name)),
      );
    }
  });
});
