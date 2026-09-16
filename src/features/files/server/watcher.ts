// Filesystem observation shared by open editors and Session artifact discovery.
// The artifact tree stays watched for the server lifetime; machine files are
// watched only while they have subscribers.
import { mkdirSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { SESSION_STORAGE_PATH } from "@sessions/model/constants";
import { sharedMap } from "@/shared/server/processState";
import type { FileWatchEvent } from "../model";

type FileObserver = { change: (event: FileWatchEvent) => void; close: () => void };
type ObservedFile = { observers: Set<FileObserver>; watcher?: FSWatcher };
type ArtifactObserver = (sessionId: string) => Promise<void>;

export class FileWatcher {
  #files = new Map<string, ObservedFile>();
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

  observeFile(path: string, change: FileObserver["change"], close: () => void): () => void {
    let file = this.#files.get(path);
    if (!file) {
      file = { observers: new Set() };
      if (this.#artifactSession(path)) {
        this.#watchArtifacts();
      } else {
        // Watching the parent also follows files replaced by atomic saves.
        file.watcher = watch(dirname(path), { persistent: false }, (_event, name) => {
          if (name && name !== basename(path)) return;
          this.#pendingFiles.add(path);
          this.#schedule();
        });
        const observers = file.observers;
        file.watcher.on("error", () => {
          for (const observer of observers) observer.close();
        });
      }
      this.#files.set(path, file);
    }

    const observer = { change, close };
    file.observers.add(observer);
    // Register before reading the revision to close the read-then-watch gap.
    this.#pendingFiles.add(path);
    this.#schedule();
    return () => {
      file.observers.delete(observer);
      if (file.observers.size) return;
      file.watcher?.close();
      this.#files.delete(path);
      this.#pendingFiles.delete(path);
    };
  }

  dispose(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#artifactWatcher?.close();
    this.#artifactWatcher = undefined;
    for (const file of this.#files.values()) {
      file.watcher?.close();
      for (const observer of file.observers) observer.close();
      file.observers.clear();
    }
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
        // Directory rename/deletion also changes every subscribed descendant.
        for (const file of this.#files.keys()) {
          if (file === path || file.startsWith(`${path}${sep}`)) this.#pendingFiles.add(file);
        }
        this.#schedule();
      },
    );
    this.#artifactWatcher.on("error", (error) => {
      console.error("Artifact observation failed:", error);
      for (const file of this.#files.values()) {
        if (!file.watcher) for (const observer of file.observers) observer.close();
      }
    });
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
      for (const path of this.#pendingFiles) {
        const observers = this.#files.get(path)?.observers;
        if (observers)
          void readFileChange(path).then((event) => {
            for (const observer of observers) observer.change(event);
          });
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

async function readFileChange(path: string): Promise<FileWatchEvent> {
  try {
    return { type: "modified", timestamp: (await Bun.file(path).stat()).mtimeMs };
  } catch {
    return { type: "deleted" };
  }
}

const watchers = sharedMap<FileWatcher>("file-watcher");
export const fileWatcher = watchers.get("shared") ?? new FileWatcher();
watchers.set("shared", fileWatcher);
