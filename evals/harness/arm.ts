import { $ } from "bun";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Arm, Experiment } from ".";

/** The project the eval runs from, whose refs arms name. */
export const repo = (await $`git rev-parse --show-toplevel`.text()).trim();
/** Built trees and run sandboxes, outside any checkout someone may be serving. */
export const scratch = join(tmpdir(), "evals");

/** Resolves each of an experiment's arms to its tree, exported and built once per ref and set of
 *  patches, and to the spec that names exactly what it measured. */
export async function prepare(experiment: Experiment, file: string): Promise<Arm[]> {
  const arms: Arm[] = [];
  for (const [name, spec] of Object.entries(experiment.arms)) {
    const match = /^([^:+]+)((?:\+[^:+]+)*):([\w-]+)\/([^@\s]+)(?:@([\w-]+))?$/.exec(spec);
    if (!match)
      throw new Error(`${name} is <ref>[+<patch>…]:<provider>/<model>[@<effort>], not ${spec}`);
    const [, ref, plus, provider, model, effort] = match as unknown as string[];
    const sha = (await $`git rev-parse --verify ${ref}^{commit}`.cwd(repo).text()).trim();
    const patches = plus!
      .split("+")
      .filter(Boolean)
      .map((patch) => resolve(dirname(file), patch));
    const hashes = await Promise.all(
      patches.map(async (patch) => `${basename(patch)}@${hash(await Bun.file(patch).bytes())}`),
    );
    const key = [sha.slice(0, 12), ...hashes].join("+");
    const tree = await build(key, sha, patches, experiment);
    const resolved = key + spec.slice(spec.indexOf(":"));
    arms.push({ name, spec: resolved, tree, provider: provider!, model: model!, effort });
  }
  return arms;
}

/** Exports the commit, applies the patches in order and has the adapter build the result. A tree
 *  is reused once its build has finished, so a failed build starts over. */
async function build(key: string, sha: string, patches: string[], { scenario }: Experiment) {
  const tree = join(scratch, key);
  if (existsSync(`${tree}.built`)) return tree;
  console.log(`building ${key}`);
  await $`rm -rf ${tree} && mkdir -p ${tree}`;
  await $`git archive ${sha} | tar -x -C ${tree}`.cwd(repo);
  for (const patch of patches) await $`git apply ${patch}`.cwd(tree);
  await scenario.adapter.build(tree);
  await Bun.write(`${tree}.built`, "");
  return tree;
}

const hash = (bytes: Uint8Array) =>
  new Bun.CryptoHasher("sha1").update(bytes).digest("hex").slice(0, 8);
