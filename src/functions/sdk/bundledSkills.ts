// Toy Box-owned skill directories embedded in the binary and copied to disk for
// the Copilot SDK, whose public session API accepts filesystem paths rather than
// in-memory skills.

import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionType } from "@/types";

const SKILL_SOURCE_PREFIX = "./skills/";
const DEFAULT_SKILLS_ROOT = join(homedir(), ".toy-box", "skills");
const BUNDLED_SKILL_FILES: Readonly<Record<string, string>> =
  typeof import.meta.glob === "function"
    ? import.meta.glob<string>("./skills/**/*", {
        eager: true,
        import: "default",
        query: "?raw",
      })
    : {};
const INTERACTIVE_SKILLS = ["run-squad"] as const;
const SESSION_SKILLS: Partial<Record<SessionType, readonly string[]>> = {
  standard: INTERACTIVE_SKILLS,
  hyper: [...INTERACTIVE_SKILLS, "create-toy-box-app", "create-toy-box-editor"],
};

/** Replace every bundled skill directory from its embedded files at server startup. */
export async function installBundledSkills(
  root = DEFAULT_SKILLS_ROOT,
  files = BUNDLED_SKILL_FILES,
): Promise<void> {
  const entries = Object.entries(files).map(([sourcePath, content]) => ({
    relativePath: sourcePath.slice(SKILL_SOURCE_PREFIX.length),
    content,
  }));
  const skillNames = new Set(entries.map(({ relativePath }) => relativePath.split("/")[0]!));

  await Promise.all(
    [...skillNames].map((skillName) =>
      rm(join(root, skillName), {
        recursive: true,
        force: true,
      }),
    ),
  );
  await Promise.all(
    entries.map(async ({ relativePath, content }) => {
      const target = join(root, relativePath);
      await Bun.write(target, content);
    }),
  );
}

export function getSessionSkillDirectories(
  sessionType: SessionType,
  root = DEFAULT_SKILLS_ROOT,
): string[] | undefined {
  const skillNames = SESSION_SKILLS[sessionType];
  if (!skillNames) return;

  return skillNames.map((name) => join(root, name));
}
