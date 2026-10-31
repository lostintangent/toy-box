import { expect, mock, onTestFinished, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { machineFile, sessionFile, type FileChange } from "../model";
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

/** Every file change published while the test runs. */
function captureChanges(): FileChange[] {
  const changes: FileChange[] = [];
  onTestFinished(
    subscribeWorkspaceEvents((event) => {
      if (event.type === "file.changed" || event.type === "file.deleted") changes.push(event);
    }),
  );
  return changes;
}

test("one artifact watcher serves discovery and every watched artifact while any tab holds it", async () => {
  const { root, watcher } = await setup();
  const path = join(root, "first", "artifacts", "report.md");
  const secondPath = join(root, "second", "artifacts", "index.html");
  await Bun.write(path, "Before");
  await Bun.write(secondPath, "Second");
  const nativeWatch = spyOn(fs, "watch");
  const sessions = new Set<string>();
  watcher.observeArtifacts(async (sessionId) => {
    sessions.add(sessionId);
  });
  const report = sessionFile("first", "report.md");
  const changes = captureChanges();
  const releaseFirstTab = watcher.watch(report, path);
  const releaseSecondTab = watcher.watch(report, path);
  const releaseOther = watcher.watch(sessionFile("second", "index.html"), secondPath);
  expect(nativeWatch).toHaveBeenCalledTimes(1);

  await Bun.write(path, "After");
  const timestamp = (await Bun.file(path).stat()).mtimeMs;
  await waitFor(() => sessions.has("first"));
  await waitFor(() =>
    changes.some((change) => change.type === "file.changed" && change.timestamp === timestamp),
  );
  expect(changes).toContainEqual({ type: "file.changed", file: report, timestamp });

  releaseFirstTab();
  await rm(path);
  await waitFor(() => changes.at(-1)?.type === "file.deleted");
  expect(changes.at(-1)).toEqual({ type: "file.deleted", file: report });
  releaseSecondTab();
  releaseOther();

  sessions.clear();
  changes.length = 0;
  await Bun.write(secondPath, "After every tab closes it");
  await waitFor(() => sessions.has("second"));
  expect(changes).toEqual([]);
  expect(nativeWatch).toHaveBeenCalledTimes(1);
});

test("artifact directory rename and recreation refresh both membership and watched descendants", async () => {
  const { root, watcher } = await setup();
  const directory = join(root, "session", "artifacts", "nested");
  const path = join(directory, "report.md");
  await Bun.write(path, "Before");
  const sessions: string[] = [];
  watcher.observeArtifacts(async (id) => {
    sessions.push(id);
  });
  const report = sessionFile("session", "nested/report.md");
  const changes = captureChanges();
  watcher.watch(report, path);

  await rename(directory, join(root, "session", "artifacts", "renamed"));
  await waitFor(() => changes.at(-1)?.type === "file.deleted" && sessions.includes("session"));

  await Bun.write(path, "Recreated");
  await waitFor(() => changes.at(-1)?.type === "file.changed");
  expect(changes.at(-1)).toEqual({
    type: "file.changed",
    file: report,
    timestamp: (await Bun.file(path).stat()).mtimeMs,
  });
});

test("machine files in one directory share its watch until the last one is released", async () => {
  const { directory, watcher } = await setup();
  const path = join(directory, "document.md");
  const sibling = join(directory, "notes.md");
  await Bun.write(path, "Before");
  await Bun.write(sibling, "Sibling");
  const nativeWatch = spyOn(fs, "watch");
  const document = machineFile(path);
  const changes = captureChanges();
  const releaseDocument = watcher.watch(document, path);
  const releaseSibling = watcher.watch(machineFile(sibling), sibling);
  expect(nativeWatch).toHaveBeenCalledTimes(1);
  const closeWatcher = spyOn(nativeWatch.mock.results[0]!.value as fs.FSWatcher, "close");

  await Bun.write(`${path}.tmp`, "Atomic replacement");
  await rename(`${path}.tmp`, path);
  const timestamp = (await Bun.file(path).stat()).mtimeMs;
  await waitFor(() =>
    changes.some((change) => change.type === "file.changed" && change.timestamp === timestamp),
  );
  await rm(path);
  await waitFor(() => changes.at(-1)?.type === "file.deleted");
  await Bun.write(path, "Recreated");
  await waitFor(() => changes.at(-1)?.type === "file.changed");
  expect(changes.at(-1)?.file).toEqual(document);

  releaseDocument();
  expect(closeWatcher).not.toHaveBeenCalled();
  releaseSibling();
  expect(closeWatcher).toHaveBeenCalledTimes(1);
  watcher.watch(document, path);
  expect(nativeWatch).toHaveBeenCalledTimes(2);
});

test("a change publishes once however many tabs watch the file", async () => {
  const { directory, watcher } = await setup();
  const path = join(directory, "document.md");
  await Bun.write(path, "Content");
  // Let creation events buffered before registration drain.
  await Bun.sleep(75);
  const nativeWatch = spyOn(fs, "watch");
  const document = machineFile(path);
  watcher.watch(document, path);
  watcher.watch(document, path);
  const changes = captureChanges();

  const [, , onDirectoryChange] = nativeWatch.mock.calls[0] as unknown as [
    string,
    fs.WatchOptions,
    (event: string, name: string) => void,
  ];
  onDirectoryChange("change", "document.md");
  await waitFor(() => changes.length > 0);
  await Bun.sleep(75);

  expect(changes).toEqual([
    { type: "file.changed", file: document, timestamp: (await Bun.file(path).stat()).mtimeMs },
  ]);
});

test("input files do not publish artifact changes, and disposal stops publishing", async () => {
  const { root, directory, watcher } = await setup();
  const artifact = join(root, "session", "artifacts", "report.md");
  const machine = join(directory, "machine.md");
  await Bun.write(artifact, "Artifact");
  await Bun.write(machine, "Machine");
  await mkdir(join(root, "session", "inputs"));
  const sessions = mock(async () => {});
  watcher.observeArtifacts(sessions);
  watcher.watch(sessionFile("session", "report.md"), artifact);
  watcher.watch(machineFile(machine), machine);

  // macOS may deliver creation events buffered before registration.
  await Bun.sleep(75);
  sessions.mockClear();
  await Bun.write(join(root, "session", "inputs", "image.png"), "Input");
  await Bun.sleep(75);
  expect(sessions).not.toHaveBeenCalled();

  const changes = captureChanges();
  watcher.dispose();
  await Bun.write(artifact, "After shutdown");
  await Bun.write(machine, "After shutdown");
  await Bun.sleep(75);
  expect(sessions).not.toHaveBeenCalled();
  expect(changes).toEqual([]);
});
