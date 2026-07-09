import type { SessionMetadata } from "@/types";

const RECENT_SESSION_LIMIT = 50;

export type RecentDirectory = {
  cwd: string;
  repository?: string;
  gitRoot?: string;
};

/** Returns unique working directories in most-recently-used order. */
export function getRecentDirectories(sessions: SessionMetadata[]): RecentDirectory[] {
  const directories = new Map<string, RecentDirectory>();
  const recentSessions = [...sessions]
    .sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime())
    .slice(0, RECENT_SESSION_LIMIT);

  for (const session of recentSessions) {
    const cwd = session.context?.workingDirectory?.trim();
    if (!cwd) continue;

    const existing = directories.get(cwd);
    directories.set(cwd, {
      cwd,
      repository: existing?.repository ?? session.context?.repository,
      gitRoot: existing?.gitRoot ?? session.context?.gitRoot,
    });
  }

  return Array.from(directories.values());
}
