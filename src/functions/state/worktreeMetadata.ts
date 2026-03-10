// SQLite-backed worktree store.
//
// Persists worktree state for sessions that use git worktrees. The SDK
// owns session content (messages, context, summary); this module tracks
// which sessions are backed by a worktree and their branch info.

import { getAppDatabase } from "../database";
import type { SessionWorktree } from "@/types";

type SessionWorktreeRow = {
  session_id: string;
  worktree_path: string | null;
  worktree_branch: string | null;
  worktree_base_branch: string | null;
  lines_added: number | null;
  lines_removed: number | null;
};

function mapRowToWorktree(row: SessionWorktreeRow): SessionWorktree {
  return {
    path: row.worktree_path ?? undefined,
    branch: row.worktree_branch ?? undefined,
    baseBranch: row.worktree_base_branch ?? undefined,
    linesAdded: row.lines_added ?? undefined,
    linesRemoved: row.lines_removed ?? undefined,
  };
}

/** Get the worktree record for a single session. Returns null if none exists. */
export async function getSessionWorktree(sessionId: string): Promise<SessionWorktree | null> {
  const db = await getAppDatabase();
  const { rows } = await db.sql`
    SELECT * FROM worktrees WHERE session_id = ${sessionId}
  `;
  const row = (rows as SessionWorktreeRow[])[0];
  return row ? mapRowToWorktree(row) : null;
}

/** Get worktree records for all sessions. Used on bootstrap to enrich the session list. */
export async function getAllSessionWorktrees(): Promise<Record<string, SessionWorktree>> {
  const db = await getAppDatabase();
  const { rows } = await db.sql`SELECT * FROM worktrees`;

  const result: Record<string, SessionWorktree> = {};
  for (const row of rows as SessionWorktreeRow[]) {
    result[row.session_id] = mapRowToWorktree(row);
  }
  return result;
}

/** Insert or update a session's worktree record. Only touches columns present in the patch. */
export async function upsertSessionWorktree(
  sessionId: string,
  data: Partial<SessionWorktree>,
): Promise<void> {
  const db = await getAppDatabase();

  const worktreePath = data.path ?? null;
  const worktreeBranch = data.branch ?? null;
  const worktreeBaseBranch = data.baseBranch ?? null;
  const linesAdded = data.linesAdded ?? null;
  const linesRemoved = data.linesRemoved ?? null;

  await db.sql`
    INSERT INTO worktrees (session_id, worktree_path, worktree_branch, worktree_base_branch, lines_added, lines_removed)
    VALUES (${sessionId}, ${worktreePath}, ${worktreeBranch}, ${worktreeBaseBranch}, ${linesAdded}, ${linesRemoved})
    ON CONFLICT(session_id) DO UPDATE SET
      worktree_path = COALESCE(excluded.worktree_path, worktrees.worktree_path),
      worktree_branch = COALESCE(excluded.worktree_branch, worktrees.worktree_branch),
      worktree_base_branch = COALESCE(excluded.worktree_base_branch, worktrees.worktree_base_branch),
      lines_added = COALESCE(excluded.lines_added, worktrees.lines_added),
      lines_removed = COALESCE(excluded.lines_removed, worktrees.lines_removed)
  `;
}

/** Remove a session's worktree record. Called during session deletion. */
export async function deleteSessionWorktree(sessionId: string): Promise<void> {
  const db = await getAppDatabase();
  await db.sql`DELETE FROM worktrees WHERE session_id = ${sessionId}`;
}
