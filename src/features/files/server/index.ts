// Filesystem behavior behind the validated public operations.

import { $ } from "bun";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import type {
  CreateFileInput,
  DirectoryEntry,
  DirectoryListing,
  ListDirectoryInput,
  SearchFilesInput,
  WorkspaceFile,
} from "../model";
import { rankFilePaths } from "../model/paths";
import { resolveWorkspaceFile } from "./paths";

const SEARCH_RESULT_LIMIT = 12;
const SCANNED_FILE_LIMIT = 20_000;

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
  showDotfiles,
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
      .filter((entry) => showDotfiles || !entry.name.startsWith("."))
      .map(async (entry) => {
        const path = resolve(targetPath, entry.name);
        const target = entry.isSymbolicLink() ? await stat(path).catch(() => null) : entry;
        const kind = target?.isDirectory() ? "directory" : target?.isFile() ? "file" : null;
        return { name: entry.name, path, kind };
      }),
  );
  const ignoredNames = await gitIgnoredNames(
    targetPath,
    classified.map((entry) => entry.name),
  );

  const directories: DirectoryEntry[] = [];
  const files: DirectoryEntry[] = [];
  for (const { name, path, kind } of classified) {
    const entry = { name, path, gitIgnored: name === ".git" || ignoredNames.has(name) };
    if (kind === "directory") directories.push(entry);
    else if (kind === "file") files.push(entry);
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

/** Files beneath a directory whose paths match a query, as paths relative to it. */
export async function searchFiles({ directory, query }: SearchFilesInput): Promise<string[]> {
  return rankFilePaths(await listFiles(resolve(directory)), query, SEARCH_RESULT_LIMIT);
}

/** Relative file paths, honoring Git ignores inside a repository. */
async function listFiles(root: string): Promise<string[]> {
  const git = Bun.spawn(["git", "ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    stdout: "pipe",
    stderr: "ignore",
  });
  const [output, exitCode] = await Promise.all([new Response(git.stdout).text(), git.exited]);
  if (exitCode === 0) return output.split("\n").filter(Boolean);

  const paths: string[] = [];
  for await (const path of new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true })) {
    if (path.split("/").includes("node_modules")) continue;
    paths.push(path);
    if (paths.length === SCANNED_FILE_LIMIT) break;
  }
  return paths;
}

async function gitIgnoredNames(directory: string, names: string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set();

  const input = Buffer.from(`${names.join("\0")}\0`);
  const result = await $`LC_ALL=C git check-ignore --stdin -z < ${input}`
    .cwd(directory)
    .quiet()
    .nothrow();
  if (result.exitCode === 0 || result.exitCode === 1) {
    return new Set(result.text().split("\0").filter(Boolean));
  }

  const message = result.stderr.toString().trim();
  // Ordinary folders and Git's own administrative directories have no ignore metadata.
  if (
    result.exitCode === 128 &&
    (message.startsWith("fatal: not a git repository (or any") ||
      message === "fatal: this operation must be run in a work tree")
  ) {
    return new Set();
  }
  throw new Error(`Git ignore check failed (exit ${result.exitCode}): ${message}`);
}

function requireFilePath(file: WorkspaceFile): string {
  const target = resolveWorkspaceFile(file);
  if (!target) throw new Error("Invalid file path.");
  return target;
}
