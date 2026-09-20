import type { Session } from "./index";

const RECENT_SESSION_LIMIT = 50;

export type RecentDirectory = {
  cwd: string;
  repository?: string;
  gitRoot?: string;
};

/** Returns unique working directories in most-recently-used order. */
export function getRecentDirectories(sessions: Session[]): RecentDirectory[] {
  const directories = new Map<string, RecentDirectory>();
  const recentSessions = [...sessions]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, RECENT_SESSION_LIMIT);

  for (const session of recentSessions) {
    const cwd = session.context?.directory?.trim();
    if (!cwd) continue;
    const previous = directories.get(cwd);
    if (previous?.repository || previous?.gitRoot) continue;
    directories.set(cwd, {
      cwd,
      repository: session.context?.repository,
      gitRoot: session.context?.gitRoot,
    });
  }

  return [...directories.values()];
}
