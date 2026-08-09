// Filesystem behavior behind the validated public operations.

import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import type {
  CreateFileInput,
  DirectoryEntry,
  DirectoryListing,
  ListDirectoryInput,
  WorkspaceFile,
} from "../model";
import { resolveWorkspaceFile } from "./paths";

export async function readFile(
  file: WorkspaceFile,
): Promise<{ content: string; timestamp: number }> {
  const absolutePath = requireFilePath(file);
  const diskFile = Bun.file(absolutePath);
  const [content, info] = await Promise.all([diskFile.text(), diskFile.stat()]);
  return { content, timestamp: info.mtimeMs };
}

export async function writeFile(
  file: WorkspaceFile,
  content: string,
): Promise<{ timestamp: number }> {
  const absolutePath = requireFilePath(file);
  await Bun.write(absolutePath, content);
  return { timestamp: (await Bun.file(absolutePath).stat()).mtimeMs };
}

/** Create one empty file without replacing an existing entry. */
export async function createFile({ directory, name }: CreateFileInput): Promise<{ path: string }> {
  if (name === "." || name === ".." || basename(name) !== name) {
    throw new Error("File name must not contain a directory path.");
  }

  const path = resolve(directory, name);
  try {
    const file = await open(path, "wx");
    await file.close();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(`A file named "${name}" already exists.`);
    }
    throw error;
  }
  return { path };
}

/** List a directory's immediate subdirectories and files (defaults to CWD). */
export async function listDirectory({
  path,
  showHidden,
}: ListDirectoryInput): Promise<DirectoryListing> {
  const requested = path ?? process.cwd();
  const targetPath =
    requested === "~"
      ? homedir()
      : requested.startsWith("~/")
        ? resolve(homedir(), requested.slice(2))
        : resolve(requested);

  if (!(await stat(targetPath)).isDirectory()) {
    throw new Error("Path is not a directory.");
  }

  const entries = await readdir(targetPath, { withFileTypes: true });
  // A symlink's Dirent describes the link, so follow it to classify its target.
  const classified = await Promise.all(
    entries
      .filter((entry) => showHidden || !entry.name.startsWith("."))
      .map(async (entry) => {
        const path = resolve(targetPath, entry.name);
        const target = entry.isSymbolicLink() ? await stat(path).catch(() => null) : entry;
        const kind = target?.isDirectory() ? "directory" : target?.isFile() ? "file" : null;
        return { name: entry.name, path, kind };
      }),
  );

  const directories: DirectoryEntry[] = [];
  const files: DirectoryEntry[] = [];
  for (const { name, path, kind } of classified) {
    if (kind === "directory") directories.push({ name, path });
    else if (kind === "file") files.push({ name, path });
  }

  const byName = (a: DirectoryEntry, b: DirectoryEntry) => a.name.localeCompare(b.name);
  directories.sort(byName);
  files.sort(byName);

  const parentPath = dirname(targetPath);
  return {
    currentPath: targetPath,
    parentPath: parentPath !== targetPath ? parentPath : null,
    directories,
    files,
  };
}

function requireFilePath(file: WorkspaceFile): string {
  const target = resolveWorkspaceFile(file);
  if (!target) throw new Error("Invalid file path.");
  return target;
}
