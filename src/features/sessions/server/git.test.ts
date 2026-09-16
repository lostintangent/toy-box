import { expect, onTestFinished, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, resolveSessionContext } from "./git";

async function directory() {
  const path = await realpath(await mkdtemp(join(tmpdir(), "toy-box-location-")));
  onTestFinished(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("resolves repository identity without replacing a selected subdirectory", async () => {
  const root = await directory();
  await git(root, "init", "-b", "main");
  await git(root, "remote", "add", "origin", "git@github.com:owner/project.git");
  const workingDirectory = join(root, "src");
  await mkdir(workingDirectory);

  expect(await resolveSessionContext(workingDirectory)).toEqual({
    workingDirectory,
    gitRoot: root,
    repository: "owner/project",
    branch: "main",
  });
});

test("recognizes a repository without commits or an origin", async () => {
  const root = await directory();
  await git(root, "init", "-b", "main");

  expect(await resolveSessionContext(root)).toEqual({
    workingDirectory: root,
    gitRoot: root,
    repository: undefined,
    branch: "main",
  });
});

test("recognizes a detached checkout without inventing a branch", async () => {
  const root = await directory();
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
    workingDirectory: root,
    gitRoot: root,
    branch: undefined,
  });
});

test("ordinary folders have only a working directory", async () => {
  const workingDirectory = await directory();
  expect(await resolveSessionContext(workingDirectory)).toEqual({ workingDirectory });
});

test("unavailable directories and damaged repositories are errors, not ordinary folders", async () => {
  const root = await directory();
  await expect(resolveSessionContext(join(root, "missing"))).rejects.toThrow();
  await Bun.write(join(root, ".git"), "invalid gitfile\n");
  await expect(resolveSessionContext(root)).rejects.toThrow();
});
