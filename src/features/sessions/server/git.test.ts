import { expect, onTestFinished, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, resolveSessionContext } from "./git";

async function createDirectory() {
  const path = await realpath(await mkdtemp(join(tmpdir(), "toy-box-location-")));
  onTestFinished(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("resolves repository identity without replacing a selected subdirectory", async () => {
  const root = await createDirectory();
  await git(root, "init", "-b", "main");
  await git(root, "remote", "add", "origin", "git@github.com:owner/project.git");
  const directory = join(root, "src");
  await mkdir(directory);

  expect(await resolveSessionContext(directory)).toEqual({
    directory,
    gitRoot: root,
    repository: "owner/project",
    branch: "main",
  });
});

test("recognizes a repository without commits or an origin", async () => {
  const root = await createDirectory();
  await git(root, "init", "-b", "main");

  expect(await resolveSessionContext(root)).toEqual({
    directory: root,
    gitRoot: root,
    repository: undefined,
    branch: "main",
  });
});

test("recognizes a detached checkout without inventing a branch", async () => {
  const root = await createDirectory();
  await git(root, "init", "-b", "main");
  await git(
    root,
    "-c",
    "user.name=Toy Box Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "fixture",
  );
  await git(root, "checkout", "--detach");

  expect(await resolveSessionContext(root)).toMatchObject({
    directory: root,
    gitRoot: root,
    branch: undefined,
  });
});

test("ordinary folders have only a working directory", async () => {
  const directory = await createDirectory();
  expect(await resolveSessionContext(directory)).toEqual({ directory });
});

test("unavailable directories and damaged repositories are errors, not ordinary folders", async () => {
  const root = await createDirectory();
  await expect(resolveSessionContext(join(root, "missing"))).rejects.toThrow();
  await Bun.write(join(root, ".git"), "invalid gitfile\n");
  await expect(resolveSessionContext(root)).rejects.toThrow();
});
