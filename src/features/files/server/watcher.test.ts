import { expect, mock, onTestFinished, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileWatchEvent } from "../model";
import { FileWatcher } from "./watcher";

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "toy-box-file-watcher-"));
  const root = join(directory, "sessions");
  const watcher = new FileWatcher(root);
  onTestFinished(async () => {
    watcher.dispose();
    mock.restore();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, root, watcher };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt++) await Bun.sleep(10);
  expect(predicate()).toBe(true);
}

test("one artifact watcher serves discovery and multiple editors across sessions", async () => {
  const { root, watcher } = await setup();
  const path = join(root, "first", "artifacts", "report.md");
  const secondPath = join(root, "second", "artifacts", "index.html");
  await Bun.write(path, "Before");
  await Bun.write(secondPath, "Second");
  const changes = new Set<string>();
  const nativeWatch = spyOn(fs, "watch");
  watcher.observeArtifacts(async (sessionId) => {
    changes.add(sessionId);
  });
  const first: FileWatchEvent[] = [];
  const second: FileWatchEvent[] = [];
  const stopFirst = watcher.observeFile(
    path,
    (event) => first.push(event),
    () => {},
  );
  const stopSecond = watcher.observeFile(
    path,
    (event) => second.push(event),
    () => {},
  );
  const stopOtherFile = watcher.observeFile(
    secondPath,
    () => {},
    () => {},
  );
  await waitFor(() => first.length > 0 && second.length > 0);
  expect(first[0]).toEqual({ type: "modified", timestamp: (await Bun.file(path).stat()).mtimeMs });
  expect(second[0]).toEqual(first[0]);
  expect(nativeWatch).toHaveBeenCalledTimes(1);

  await Bun.write(path, "After");
  const timestamp = (await Bun.file(path).stat()).mtimeMs;
  await waitFor(
    () =>
      first.some((event) => event.type === "modified" && event.timestamp === timestamp) &&
      second.some((event) => event.type === "modified" && event.timestamp === timestamp),
  );
  await waitFor(() => changes.has("first"));
  stopFirst();
  const firstCount = first.length;
  await rm(path);
  await waitFor(() => second.at(-1)?.type === "deleted");
  expect(first).toHaveLength(firstCount);
  stopSecond();
  stopOtherFile();

  changes.clear();
  await Bun.write(secondPath, "After all editors close");
  await waitFor(() => changes.has("second"));
  expect(nativeWatch).toHaveBeenCalledTimes(1);
});

test("artifact directory rename and recreation refresh both membership and open descendants", async () => {
  const { root, watcher } = await setup();
  const directory = join(root, "session", "artifacts", "nested");
  const path = join(directory, "report.md");
  await Bun.write(path, "Before");
  const changes: string[] = [];
  watcher.observeArtifacts(async (id) => {
    changes.push(id);
  });
  const events: FileWatchEvent[] = [];
  watcher.observeFile(
    path,
    (event) => events.push(event),
    () => {},
  );
  await waitFor(() => events.length > 0);
  await rename(directory, join(root, "session", "artifacts", "renamed"));
  await waitFor(() => events.at(-1)?.type === "deleted" && changes.includes("session"));

  await Bun.write(path, "Recreated");
  await waitFor(() => events.at(-1)?.type === "modified");
  expect(events.at(-1)).toEqual({
    type: "modified",
    timestamp: (await Bun.file(path).stat()).mtimeMs,
  });
});

test("machine file observers share one watcher until the last subscription closes", async () => {
  const { directory, watcher } = await setup();
  const path = join(directory, "document.md");
  await Bun.write(path, "Before");
  const nativeWatch = spyOn(fs, "watch");
  const first: FileWatchEvent[] = [];
  const second: FileWatchEvent[] = [];
  const stopFirst = watcher.observeFile(
    path,
    (event) => first.push(event),
    () => {},
  );
  const stopSecond = watcher.observeFile(
    path,
    (event) => second.push(event),
    () => {},
  );
  await waitFor(() => first.length > 0 && second.length > 0);
  expect(nativeWatch).toHaveBeenCalledTimes(1);
  const closeWatcher = spyOn(nativeWatch.mock.results[0]!.value as fs.FSWatcher, "close");

  stopFirst();
  expect(closeWatcher).not.toHaveBeenCalled();
  const firstCount = first.length;
  await Bun.write(`${path}.tmp`, "Atomic replacement");
  await rename(`${path}.tmp`, path);
  const timestamp = (await Bun.file(path).stat()).mtimeMs;
  await waitFor(() =>
    second.some((event) => event.type === "modified" && event.timestamp === timestamp),
  );
  expect(first).toHaveLength(firstCount);
  await rm(path);
  await waitFor(() => second.at(-1)?.type === "deleted");
  await Bun.write(path, "Recreated");
  await waitFor(() => second.at(-1)?.type === "modified");

  stopSecond();
  expect(closeWatcher).toHaveBeenCalledTimes(1);
  watcher.observeFile(
    path,
    () => {},
    () => {},
  );
  expect(nativeWatch).toHaveBeenCalledTimes(2);
});

test("input files do not publish artifact changes and disposal releases watcher", async () => {
  const { root, directory, watcher } = await setup();
  const artifact = join(root, "session", "artifacts", "report.md");
  const machine = join(directory, "machine.md");
  await Bun.write(artifact, "Artifact");
  await Bun.write(machine, "Machine");
  await mkdir(join(root, "session", "inputs"));
  const changes = mock(async () => {});
  watcher.observeArtifacts(changes);
  const closeArtifact = mock(() => {});
  const closeMachine = mock(() => {});
  watcher.observeFile(artifact, () => {}, closeArtifact);
  watcher.observeFile(machine, () => {}, closeMachine);

  // macOS may deliver creation events buffered before registration.
  await Bun.sleep(75);
  changes.mockClear();
  await Bun.write(join(root, "session", "inputs", "image.png"), "Input");
  await Bun.sleep(75);
  expect(changes).not.toHaveBeenCalled();

  watcher.dispose();
  expect(closeArtifact).toHaveBeenCalledTimes(1);
  expect(closeMachine).toHaveBeenCalledTimes(1);
  await Bun.write(artifact, "After shutdown");
  await Bun.sleep(75);
  expect(changes).not.toHaveBeenCalled();
});
