import { $ } from "bun";
import { describe, expect, jest, mock, onTestFinished, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as runtime from "@sessions/server/runtime";
import { closeConnection, openConnection } from "@workspace/server/connections";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { machineFile, sessionFile, type DirectoryEntry, type FileChange } from "../model";
import { listDirectory, readFile, watchFile, writeFile } from "./index";
import * as paths from "./paths";

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

describe("file reads", () => {
  async function readContent(name: string, bytes: string | Uint8Array) {
    const file = machineFile(join(await fixture(), name));
    await Bun.write(file.path, bytes);
    return (await readFile(file)).content;
  }

  test("text reads in full, even with a character across the binary probe", async () => {
    const text = `${"a".repeat(7_999)}é and more`;
    expect(await readContent("notes.md", text)).toBe(text);
  });

  test("a file with a NUL or bytes that aren't UTF-8 reads as null content", async () => {
    const utf16 = new Uint8Array([0x68, 0, 0x69, 0]);
    const latin1 = new Uint8Array([...new TextEncoder().encode("a".repeat(9_000)), 0xe9]);
    expect(await readContent("utf16.txt", utf16)).toBeNull();
    expect(await readContent("latin1.txt", latin1)).toBeNull();
  });
});

describe("file watching", () => {
  async function watchedDocument() {
    const directory = await fixture();
    const file = machineFile(join(directory, "document.md"));
    await Bun.write(file.path, "Before");
    const changes: FileChange[] = [];
    onTestFinished(
      subscribeWorkspaceEvents((event) => {
        if (event.type === "file.changed" || event.type === "file.deleted") changes.push(event);
      }),
    );
    return { file, changes };
  }

  test("reports the file's current state, then publishes its changes", async () => {
    const { file, changes } = await watchedDocument();
    const connection = openConnection();
    onTestFinished(() => closeConnection(connection));

    const { change } = await watchFile(connection, file);
    expect(change).toEqual({
      type: "file.changed",
      file,
      timestamp: (await Bun.file(file.path).stat()).mtimeMs,
    });

    const { timestamp } = await writeFile(file, "After");
    await waitFor(() =>
      changes.some((event) => "timestamp" in event && event.timestamp === timestamp),
    );
  });

  test("stops publishing once the tab's connection closes", async () => {
    const { file, changes } = await watchedDocument();
    const connection = openConnection();
    await watchFile(connection, file);
    closeConnection(connection);

    await writeFile(file, "After");
    await Bun.sleep(100);
    expect(changes).toEqual([]);
  });
});

describe("edit notices", () => {
  async function notices() {
    const directory = await fixture();
    // Session files resolve under the temporary directory instead of the real session storage.
    spyOn(paths, "resolveWorkspaceFile").mockImplementation((file) =>
      join(directory, file.path.replace(/^\//, "")),
    );
    const deliver = spyOn(runtime, "deliverSessionMessage").mockResolvedValue({
      disposition: "queued",
      waitForCompletion: async () => ({ status: "completed" }),
    });
    jest.useFakeTimers();
    onTestFinished(() => {
      jest.useRealTimers();
      mock.restore();
    });
    return { file: sessionFile("owner", "report.md"), deliver };
  }

  test("edits reach the owning session once after they pause, with no surface left open", async () => {
    const { file, deliver } = await notices();
    await writeFile(file, "First", true);
    jest.advanceTimersByTime(5_000);
    await writeFile(file, "Second", true);
    jest.advanceTimersByTime(7_999);
    expect(deliver).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(deliver.mock.calls).toEqual([
      ["owner", { systemMessage: { type: "file_edited", file } }],
    ]);
  });

  test("writes that don't ask, and files no session owns, notify no one", async () => {
    const { file, deliver } = await notices();
    await writeFile(file, "Quiet");
    await writeFile(machineFile("/notes.md"), "Unowned", true);
    jest.advanceTimersByTime(8_000);
    expect(deliver).not.toHaveBeenCalled();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt++) await Bun.sleep(10);
  expect(predicate()).toBe(true);
}
