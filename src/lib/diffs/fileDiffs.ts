import type { ToolCall } from "@/types";

export type DiffStats = {
  added: number;
  removed: number;
};

export type DiffHunk = {
  oldText: string;
  newText: string;
  lines?: Array<{ type: "context" | "added" | "removed"; text: string }>;
  stats: DiffStats;
};

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

type HunkDraft = {
  oldLines: string[];
  newLines: string[];
  lines: NonNullable<DiffHunk["lines"]>;
  stats: DiffStats;
};

const DEV_NULL = "/dev/null";

function readStringArg(toolCall: ToolCall, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = toolCall.arguments[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function normalizeDiffPath(rawPath: string, cwd?: string): string {
  const tabIndex = rawPath.indexOf("\t");
  const path = tabIndex === -1 ? rawPath : rawPath.slice(0, tabIndex);
  const cleanPath = path.trim();
  if (cleanPath === DEV_NULL) return cleanPath;

  const withoutGitPrefix = /^[ab]\//.test(cleanPath) ? cleanPath.slice(2) : cleanPath;
  if (withoutGitPrefix === "dev/null") return DEV_NULL;
  if (!cwd || withoutGitPrefix.startsWith("/")) return withoutGitPrefix;

  const maybeAbsolutePath = `/${withoutGitPrefix}`;
  if (maybeAbsolutePath === cwd || maybeAbsolutePath.startsWith(`${cwd}/`)) {
    return maybeAbsolutePath;
  }

  return withoutGitPrefix;
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

function createHunkDraft(): HunkDraft {
  return {
    oldLines: [],
    newLines: [],
    lines: [],
    stats: { added: 0, removed: 0 },
  };
}

function hunkFromLines(hunk: HunkDraft): DiffHunk | undefined {
  if (hunk.oldLines.length === 0 && hunk.newLines.length === 0) return undefined;
  return {
    oldText: hunk.oldLines.join("\n"),
    newText: hunk.newLines.join("\n"),
    lines: hunk.lines.map((line) => ({ ...line })),
    stats: { ...hunk.stats },
  };
}

function pushHunk(file: FileDraft | undefined, hunk: HunkDraft | undefined): void {
  if (!file || !hunk) return;
  const changeHunk = hunkFromLines(hunk);
  if (changeHunk) file.hunks.push(changeHunk);
}

function pushFile(files: FileDiff[], file: FileDraft | undefined): void {
  if (!file || !file.path) return;
  files.push({
    path: file.path,
    status: file.status,
    hunks: file.hunks,
  });
}

export function parsePatch(patch: string, cwd?: string): FileDiff[] {
  const files: FileDiff[] = [];
  let currentFile: FileDraft | undefined;
  let currentHunk: HunkDraft | undefined;

  function commitHunk() {
    pushHunk(currentFile, currentHunk);
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

  for (const line of patch.split("\n")) {
    if (currentHunk && !line.startsWith("\\ No newline at end of file")) {
      if (line.startsWith("+")) {
        const text = line.slice(1);
        currentHunk.newLines.push(text);
        currentHunk.lines.push({ type: "added", text });
        currentHunk.stats.added++;
        continue;
      }
      if (line.startsWith("-")) {
        const text = line.slice(1);
        currentHunk.oldLines.push(text);
        currentHunk.lines.push({ type: "removed", text });
        currentHunk.stats.removed++;
        continue;
      }
      if (line.startsWith(" ")) {
        const content = line.slice(1);
        currentHunk.oldLines.push(content);
        currentHunk.newLines.push(content);
        currentHunk.lines.push({ type: "context", text: content });
        continue;
      }
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
      currentHunk = createHunkDraft();
      continue;
    }

    if (!currentHunk || line.startsWith("\\ No newline at end of file")) continue;
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

function getEditFileDiffs(toolCall: ToolCall): FileDiff[] {
  const path = readStringArg(toolCall, "path", "filePath") ?? "Unknown file";
  const oldText = readStringArg(toolCall, "old_str", "oldString") ?? "";
  const newText = readStringArg(toolCall, "new_str", "newString") ?? "";
  const hunks =
    oldText || newText ? [{ oldText, newText, stats: computeDiffStats(oldText, newText) }] : [];
  return [
    {
      path,
      status: "modified",
      hunks,
    },
  ];
}

function getPatchFileDiffs(toolCall: ToolCall, cwd?: string): FileDiff[] | undefined {
  const details = toolCall.result?.details;

  return toolCall.result?.success === true && details ? parsePatch(details, cwd) : undefined;
}

export function getToolCallFileDiffs(toolCall: ToolCall, cwd?: string): FileDiff[] | undefined {
  if (toolCall.name === "edit") {
    return getEditFileDiffs(toolCall);
  }

  if (toolCall.name === "patch") {
    return getPatchFileDiffs(toolCall, cwd);
  }

  return undefined;
}

/** Computes added/removed line counts by finding common prefix/suffix. */
export function computeDiffStats(oldText: string, newText: string): DiffStats {
  if (!oldText && !newText) return { added: 0, removed: 0 };
  if (!oldText) return { added: newText.split("\n").length, removed: 0 };
  if (!newText) return { added: 0, removed: oldText.split("\n").length };

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const removedCount = oldLines.length - prefixLen - suffixLen;
  const addedCount = newLines.length - prefixLen - suffixLen;

  return { added: Math.max(0, addedCount), removed: Math.max(0, removedCount) };
}

export function computeFileDiffStats(fileDiffs: FileDiff[]): {
  total: DiffStats;
  byFile: Array<{ path: string; diff: DiffStats }>;
} {
  if (!fileDiffs.length) return { total: { added: 0, removed: 0 }, byFile: [] };

  const byFile = new Map<string, { path: string; diff: DiffStats }>();
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const file of fileDiffs) {
    for (const hunk of file.hunks) {
      const diff = hunk.stats;
      const existing = byFile.get(file.path);
      if (existing) {
        existing.diff.added += diff.added;
        existing.diff.removed += diff.removed;
      } else {
        byFile.set(file.path, {
          path: file.path,
          diff: { added: diff.added, removed: diff.removed },
        });
      }
      totalAdded += diff.added;
      totalRemoved += diff.removed;
    }
  }

  return {
    total: { added: totalAdded, removed: totalRemoved },
    byFile: Array.from(byFile.values()),
  };
}
