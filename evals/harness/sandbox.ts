import { $ } from "bun";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Arm, Sandbox } from ".";
import { scratch } from "./arm";

/** A run's own folders under the scratch folder, an environment of only the variables named here
 *  and the arm's credential, and the fixture committed as the work folder's only commit. Removing
 *  the folder that holds `home` removes all of it. */
export async function isolate(
  arm: Arm,
  fixture: Record<string, string>,
  signal: AbortSignal,
  out: string,
): Promise<Sandbox> {
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "run-"));
  const folder = (name: string) => {
    mkdirSync(join(root, name));
    return join(root, name);
  };
  const [home, tmp, bin, work] = [folder("home"), folder("tmp"), folder("bin"), folder("work")];
  const env = {
    ...pick("LANG", "USER", "SHELL"),
    HOME: home,
    TMPDIR: tmp,
    PATH: `${bin}:${process.env.PATH}`,
    ...(await credential(arm, home)),
  };
  for (const [path, content] of Object.entries(fixture)) await Bun.write(join(work, path), content);
  const author = ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com"];
  await $`git init -q && git add -A && git ${author} commit -qm fixture`.cwd(work).env(env).quiet();
  return { home, tmp, bin, work, env, signal, out };
}

/** Copilot takes a token. Claude shares your login keychain, so its runs use your real login and
 *  aren't isolated from it. Codex gets nothing, since a refresh in a copy of its login would
 *  rotate the real one, so its server offers no models and its runs are invalid. */
async function credential({ provider }: Arm, home: string): Promise<Record<string, string>> {
  if (provider === "copilot") {
    const token = process.env.COPILOT_GITHUB_TOKEN ?? (await $`gh auth token`.text()).trim();
    return { COPILOT_GITHUB_TOKEN: token };
  }
  if (provider !== "claude") return {};
  mkdirSync(join(home, "Library"));
  symlinkSync(join(homedir(), "Library/Keychains"), join(home, "Library/Keychains"));
  return pick("CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY");
}

const pick = (...names: string[]): Record<string, string> =>
  Object.fromEntries(
    names.flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])),
  );
