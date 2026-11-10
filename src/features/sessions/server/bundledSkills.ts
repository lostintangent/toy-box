// Toy Box-owned skills embedded in the binary and materialized for providers.

import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { SerialTaskQueue } from "@/shared/serialTaskQueue";
import { sharedMap } from "@/shared/server/processState";

const installations = sharedMap<SerialTaskQueue>("bundled-skill-installations");

const SKILL_PATH_MARKER = "/skills/";
const DEFAULT_SKILLS_ROOT = join(homedir(), ".toy-box", "skills");
const UNIVERSAL_SKILLS = [
  "create-toy-box-app",
  "create-toy-box-brief",
  "execute-toy-box-brief",
] as const;

/** Replace every bundled skill directory from its embedded files at server startup. */
export function installBundledSkills(
  files: Readonly<Record<string, string>>,
  root = DEFAULT_SKILLS_ROOT,
): Promise<void> {
  let queue = installations.get(root);
  if (!queue) {
    queue = new SerialTaskQueue();
    installations.set(root, queue);
  }
  return queue.enqueue(() => replaceBundledSkills(files, root));
}

async function replaceBundledSkills(
  files: Readonly<Record<string, string>>,
  root: string,
): Promise<void> {
  const entries = Object.entries(files).map(([sourcePath, content]) => ({
    relativePath: sourcePath.slice(
      sourcePath.indexOf(SKILL_PATH_MARKER) + SKILL_PATH_MARKER.length,
    ),
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

export function getSessionSkillDirectories(root = DEFAULT_SKILLS_ROOT): string[] {
  return UNIVERSAL_SKILLS.map((name) => join(root, name));
}
