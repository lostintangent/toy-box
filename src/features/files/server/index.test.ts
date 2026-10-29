import { $ } from "bun";
import { describe, expect, onTestFinished, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DirectoryEntry } from "../model";
import { listDirectory } from "./index";

async function fixture(repository = false): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "toy-box-directory with spaces-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  if (repository) {
    await $`git init --quiet --template= ${directory}`.quiet();
    await $`git -C ${directory} config core.excludesFile /dev/null`.quiet();
  }
  return directory;
}

function ignoreFlags(entries: DirectoryEntry[]): Record<string, boolean> {
  return Object.fromEntries(entries.map(({ name, gitIgnored }) => [name, gitIgnored]));
}

describe("directory listings", () => {
  test("empty and non-Git directories stay browsable with gitIgnored false", async () => {
    const directory = await fixture();
    const empty = await listDirectory({ path: directory });
    expect(empty.directories).toEqual([]);
    expect(empty.files).toEqual([]);

    await mkdir(join(directory, "folder"));
    await Bun.write(join(directory, "notes.txt"), "");
    const listing = await listDirectory({ path: directory });
    expect(ignoreFlags(listing.directories)).toEqual({ folder: false });
    expect(ignoreFlags(listing.files)).toEqual({ "notes.txt": false });
  });

  test("annotates entries without hiding them, splitting literal names, or ignoring tracked files", async () => {
    const directory = await fixture(true);
    const ignoredName = "--odd $name; 'quoted'\nfile.log";
    await Bun.write(join(directory, ".gitignore"), "*.log\ncache/\n");
    for (const name of [ignoredName, "tracked.log", "source.ts"]) {
      await Bun.write(join(directory, name), "");
    }
    await mkdir(join(directory, "cache"));
    await mkdir(join(directory, "source"));
    await $`git -C ${directory} add --force -- tracked.log`.quiet();

    const listing = await listDirectory({ path: directory, showDotfiles: true });
    expect(ignoreFlags(listing.directories)).toEqual({
      ".git": true,
      cache: true,
      source: false,
    });
    expect(ignoreFlags(listing.files)).toEqual({
      ".gitignore": false,
      [ignoredName]: true,
      "source.ts": false,
      "tracked.log": false,
    });
  });

  test("a repository with no ignored entries still returns gitIgnored false", async () => {
    const directory = await fixture(true);
    await Bun.write(join(directory, "notes.txt"), "");
    const listing = await listDirectory({ path: directory });
    expect(ignoreFlags(listing.files)).toEqual({ "notes.txt": false });
  });

  test("expanding an ignored folder marks its children as ignored", async () => {
    const directory = await fixture(true);
    const ignored = join(directory, "ignored");
    await mkdir(join(ignored, "nested"), { recursive: true });
    await Bun.write(join(directory, ".gitignore"), "ignored/\n");
    await Bun.write(join(ignored, "notes.txt"), "");

    const listing = await listDirectory({ path: ignored });
    expect(ignoreFlags(listing.directories)).toEqual({ nested: true });
    expect(ignoreFlags(listing.files)).toEqual({ "notes.txt": true });
  });

  test("marks a .git file when repository metadata lives elsewhere", async () => {
    const directory = await fixture();
    const worktree = join(directory, "worktree");
    const metadata = join(directory, "metadata");
    await $`git init --quiet --template= --separate-git-dir ${metadata} ${worktree}`.quiet();
    const listing = await listDirectory({ path: worktree, showDotfiles: true });
    expect(ignoreFlags(listing.files)).toEqual({ ".git": true });
  });

  test("Git administrative directories have no ignore metadata", async () => {
    const directory = await fixture(true);
    const listing = await listDirectory({ path: join(directory, ".git"), showDotfiles: true });
    const entries = [...listing.directories, ...listing.files];
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.gitIgnored === false)).toBe(true);
  });

  test("unexpected Git failures are surfaced instead of reporting unignored entries", async () => {
    const directory = await fixture(true);
    await Bun.write(join(directory, "notes.txt"), "");
    await Bun.write(join(directory, ".git/index"), "broken");
    await expect(listDirectory({ path: directory })).rejects.toThrow();
  });
});
