// Filesystem observation shared by open files and Session artifact discovery.
// The artifact tree stays watched for the server lifetime; a machine file's
// directory is watched only while some file in it is. Each change to a watched
// file is published once, however many tabs watch it.
import { mkdirSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { SESSION_STORAGE_PATH } from "@sessions/model/constants";
import { broadcast } from "@workspace/server/events";
import { sharedMap } from "@/shared/server/processState";
import { workspaceFileId, type FileChange, type WorkspaceFile } from "../model";

type WatchedFile = { file: WorkspaceFile; path: string; leases: number };
type ArtifactObserver = (sessionId: string) => Promise<void>;

export class FileWatcher {
  /** Watched files by address, each held by as many leases as tabs watch it. */
  #files = new Map<string, WatchedFile>();
  #directories = new Map<string, FSWatcher>();
  #artifactObservers = new Set<ArtifactObserver>();
  #artifactWatcher?: FSWatcher;
  #pendingFiles = new Set<string>();
  #pendingSessions = new Set<string>();
  #timer?: ReturnType<typeof setTimeout>;

  constructor(readonly root = resolve(homedir(), SESSION_STORAGE_PATH)) {}

  observeArtifacts(onChange: ArtifactObserver): () => void {
    this.#watchArtifacts();
    this.#artifactObservers.add(onChange);
    return () => this.#artifactObservers.delete(onChange);
  }

  /** Publish changes to `file`, at its resolved `path`, until the returned release. */
  watch(file: WorkspaceFile, path: string): () => void {
    const id = workspaceFileId(file);
    let watched = this.#files.get(id);
    if (!watched) {
      if (this.#artifactSession(path)) this.#watchArtifacts();
      else this.#watchDirectory(dirname(path));
      watched = { file, path, leases: 0 };
      this.#files.set(id, watched);
    }
    watched.leases++;

    return () => {
      if (--watched.leases > 0) return;
      this.#files.delete(id);
      const directory = dirname(path);
      if ([...this.#files.values()].some((other) => dirname(other.path) === directory)) return;
      this.#directories.get(directory)?.close();
      this.#directories.delete(directory);
    };
  }

  dispose(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#artifactWatcher?.close();
    this.#artifactWatcher = undefined;
    for (const watcher of this.#directories.values()) watcher.close();
    this.#directories.clear();
    this.#files.clear();
    this.#artifactObservers.clear();
    this.#pendingFiles.clear();
    this.#pendingSessions.clear();
  }

  #watchArtifacts(): void {
    if (this.#artifactWatcher) return;
    mkdirSync(this.root, { recursive: true });
    this.#artifactWatcher = watch(
      this.root,
      { recursive: true, persistent: false },
      (_event, name) => {
        if (!name) return;
        const path = resolve(this.root, name);
        const sessionId = this.#artifactSession(path);
        if (!sessionId) return;
        this.#pendingSessions.add(sessionId);
        // Directory rename/deletion also changes every watched descendant.
        for (const { path: file } of this.#files.values()) {
          if (file === path || file.startsWith(`${path}${sep}`)) this.#pendingFiles.add(file);
        }
        this.#schedule();
      },
    );
    this.#artifactWatcher.on("error", (error) =>
      console.error("Artifact observation failed:", error),
    );
  }

  #watchDirectory(directory: string): void {
    if (this.#directories.has(directory)) return;
    // Watching the parent also follows files replaced by atomic saves.
    const watcher = watch(directory, { persistent: false }, (_event, name) => {
      if (!name) return;
      this.#pendingFiles.add(join(directory, name));
      this.#schedule();
    });
    watcher.on("error", (error) => console.error(`Unable to watch ${directory}:`, error));
    this.#directories.set(directory, watcher);
  }

  #artifactSession(path: string): string | undefined {
    const [sessionId, directory] = relative(this.root, path).split(sep);
    return sessionId && sessionId !== ".." && (!directory || directory === "artifacts")
      ? sessionId
      : undefined;
  }

  #schedule(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      for (const { file, path } of this.#files.values()) {
        if (this.#pendingFiles.has(path)) void readFileChange(file, path).then(broadcast);
      }
      this.#pendingFiles.clear();
      for (const sessionId of this.#pendingSessions) {
        for (const onChange of this.#artifactObservers)
          void onChange(sessionId).catch((error) =>
            console.error(`Unable to refresh artifacts for session ${sessionId}:`, error),
          );
      }
      this.#pendingSessions.clear();
    }, 25);
  }
}

/** A file's current state on disk, as the event that publishes it. */
export async function readFileChange(file: WorkspaceFile, path: string): Promise<FileChange> {
  try {
    return { type: "file.changed", file, timestamp: (await Bun.file(path).stat()).mtimeMs };
  } catch {
    return { type: "file.deleted", file };
  }
}

const watchers = sharedMap<FileWatcher>("file-watcher");
export const fileWatcher = watchers.get("shared") ?? new FileWatcher();
watchers.set("shared", fileWatcher);
