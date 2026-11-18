import type { ToolCall } from "./index";
import type { DiffStats } from "@/shared/diffStats";

/** One hunk's lines, in order, each tagged by the side it belongs to. */
export type DiffHunk = Array<{ type: "context" | "added" | "removed"; text: string }>;

export type FileDiff = {
  path: string;
  status: "added" | "modified" | "deleted";
  hunks: DiffHunk[];
};

export type PatchTouchedFile = Pick<FileDiff, "path" | "status">;

type FileDraft = FileDiff & {
  oldPath?: string;
  newPath?: string;
};

const DEV_NULL = "/dev/null";

const LINE_TYPES: Record<string, DiffHunk[number]["type"] | undefined> = {
  "+": "added",
  "-": "removed",
  " ": "context",
};

function normalizeDiffPath(rawPath: string, cwd?: string): string {
  const tabIndex = rawPath.indexOf("\t");
  const path = tabIndex === -1 ? rawPath : rawPath.slice(0, tabIndex);
  const cleanPath = path.trim();
  if (cleanPath === DEV_NULL) return cleanPath;

  const withoutGitPrefix = /^[ab]\//.test(cleanPath) ? cleanPath.slice(2) : cleanPath;
  if (withoutGitPrefix === "dev/null") return DEV_NULL;
  return resolveDiffPath(withoutGitPrefix, cwd);
}

/** Restores the leading slash a git prefix replaced on a path inside `cwd`, which
 *  keys a path normalized without a cwd the same as one normalized with it. */
function resolveDiffPath(path: string, cwd?: string): string {
  if (!cwd || path.startsWith("/")) return path;

  const maybeAbsolutePath = `/${path}`;
  if (maybeAbsolutePath === cwd || maybeAbsolutePath.startsWith(`${cwd}/`)) {
    return maybeAbsolutePath;
  }

  return path;
}

function statusFromPaths(
  oldPath: string | undefined,
  newPath: string | undefined,
): FileDiff["status"] {
  if (oldPath === DEV_NULL) return "added";
  if (newPath === DEV_NULL) return "deleted";
  return "modified";
}

function displayPathFromPaths(oldPath: string | undefined, newPath: string | undefined): string {
  return newPath && newPath !== DEV_NULL ? newPath : oldPath && oldPath !== DEV_NULL ? oldPath : "";
}

function pushFile(files: FileDiff[], file: FileDraft | undefined): void {
  if (!file || !file.path) return;
  files.push({
    path: file.path,
    status: file.status,
    hunks: file.hunks,
  });
}

export function parseUnifiedDiff(diff: string, cwd?: string): FileDiff[] {
  const files: FileDiff[] = [];
  let currentFile: FileDraft | undefined;
  let currentHunk: DiffHunk | undefined;

  function commitHunk() {
    if (currentFile && currentHunk?.length) currentFile.hunks.push(currentHunk);
    currentHunk = undefined;
  }

  function commitFile() {
    commitHunk();
    pushFile(files, currentFile);
    currentFile = undefined;
  }

  function ensureCurrentFile() {
    if (!currentFile) {
      currentFile = { path: "", status: "modified", hunks: [] };
    }
    return currentFile;
  }

  for (const line of diff.split("\n")) {
    const type = LINE_TYPES[line[0]];
    if (currentHunk && type) {
      currentHunk.push({ type, text: line.slice(1) });
      continue;
    }

    if (line.startsWith("diff --git ")) {
      commitFile();
      currentFile = { path: "", status: "modified", hunks: [] };
      continue;
    }

    if (line.startsWith("--- ")) {
      const file = ensureCurrentFile();
      file.oldPath = normalizeDiffPath(line.slice(4), cwd);
      file.status = statusFromPaths(file.oldPath, file.newPath);
      file.path = displayPathFromPaths(file.oldPath, file.newPath);
      continue;
    }

    if (line.startsWith("+++ ")) {
      const file = ensureCurrentFile();
      file.newPath = normalizeDiffPath(line.slice(4), cwd);
      file.status = statusFromPaths(file.oldPath, file.newPath);
      file.path = displayPathFromPaths(file.oldPath, file.newPath);
      continue;
    }

    if (line.startsWith("@@")) {
      commitHunk();
      currentHunk = [];
    }
  }

  commitFile();
  return files;
}

export function parsePatchTouchedFiles(patch: string, cwd?: string): PatchTouchedFile[] {
  const files = new Map<string, FileDiff["status"]>();
  let oldPath: string | undefined;
  let newPath: string | undefined;
  let isInHunk = false;

  function addFile(path: string, status: FileDiff["status"]) {
    if (!path || path === DEV_NULL) return;
    files.delete(path);
    files.set(path, status);
  }

  function commitUnifiedFile() {
    if (!oldPath && !newPath) return;

    addFile(displayPathFromPaths(oldPath, newPath), statusFromPaths(oldPath, newPath));
    oldPath = undefined;
    newPath = undefined;
  }

  for (const line of patch.split("\n")) {
    const applyPatchFile = readApplyPatchFile(line, cwd);
    if (applyPatchFile) {
      commitUnifiedFile();
      addFile(applyPatchFile.path, applyPatchFile.status);
      isInHunk = false;
      continue;
    }

    if (line.startsWith("diff --git ")) {
      commitUnifiedFile();
      isInHunk = false;
      continue;
    }

    if (line.startsWith("@@")) {
      isInHunk = true;
      continue;
    }

    if (isInHunk) continue;

    if (line.startsWith("--- ")) {
      oldPath = normalizeDiffPath(line.slice(4), cwd);
      continue;
    }

    if (line.startsWith("+++ ")) {
      newPath = normalizeDiffPath(line.slice(4), cwd);
    }
  }

  commitUnifiedFile();

  return Array.from(files, ([path, status]) => ({ path, status }));
}

function readApplyPatchFile(line: string, cwd?: string): PatchTouchedFile | undefined {
  const match = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
  if (!match) return undefined;

  const path = normalizeDiffPath(match[2], cwd);
  if (!path || path === DEV_NULL) return undefined;

  return {
    path,
    status: statusFromApplyPatchVerb(match[1] as "Add" | "Update" | "Delete"),
  };
}

function statusFromApplyPatchVerb(verb: "Add" | "Update" | "Delete"): FileDiff["status"] {
  if (verb === "Add") return "added";
  if (verb === "Delete") return "deleted";
  return "modified";
}

function getCompletedFileDiffs(toolCall: ToolCall, cwd?: string): FileDiff[] | undefined {
  const details = toolCall.result?.details;

  return toolCall.result?.success === true && details ? parseUnifiedDiff(details, cwd) : undefined;
}

export function getToolCallFileDiffs(toolCall: ToolCall, cwd?: string): FileDiff[] | undefined {
  if (toolCall.name === "edit" || toolCall.name === "patch") {
    return getCompletedFileDiffs(toolCall, cwd);
  }

  return undefined;
}

/** Line counts of file diffs, in total and per file. */
export type FileDiffStats = {
  total: DiffStats;
  byFile: Array<{ path: string; diff: DiffStats }>;
};

export function computeFileDiffStats(fileDiffs: FileDiff[]): FileDiffStats {
  return sumFileDiffStats(
    fileDiffs.flatMap(({ path, hunks }) =>
      hunks.map((hunk) => {
        const diff = { added: 0, removed: 0 };
        for (const { type } of hunk) if (type !== "context") diff[type]++;
        return { total: diff, byFile: [{ path, diff }] };
      }),
    ),
  );
}

/** Adds diff stats, merging files by path in first-seen order. */
export function sumFileDiffStats(summaries: Iterable<FileDiffStats>): FileDiffStats {
  const total = { added: 0, removed: 0 };
  const byFile = new Map<string, { path: string; diff: DiffStats }>();
  for (const summary of summaries) {
    total.added += summary.total.added;
    total.removed += summary.total.removed;
    for (const { path, diff } of summary.byFile) {
      const file = byFile.get(path) ?? { path, diff: { added: 0, removed: 0 } };
      file.diff.added += diff.added;
      file.diff.removed += diff.removed;
      byFile.set(path, file);
    }
  }
  return { total, byFile: [...byFile.values()] };
}

/** Diff stats keyed by `cwd`-resolved paths, merging keys that resolve alike. */
export function resolveFileDiffStats(diff: FileDiffStats, cwd?: string): FileDiffStats {
  return sumFileDiffStats([
    {
      ...diff,
      byFile: diff.byFile.map((file) => ({ ...file, path: resolveDiffPath(file.path, cwd) })),
    },
  ]);
}
