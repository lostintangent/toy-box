// CopilotSession object cache and session lifecycle orchestration.
//
// The SDK persists sessions to disk; this module caches live
// CopilotSession objects in memory to avoid redundant resume calls.
// It also owns the deleteSession workflow, which coordinates cleanup
// across streaming buffers, unread state, attachments, and SDK
// persistence.

import { homedir } from "node:os";
import type { CopilotSession } from "@github/copilot-sdk";
import {
  createSession as sdkCreateSession,
  resumeSession as sdkResumeSession,
  deleteSession as sdkDeleteSession,
  readSessionContextFromEvents,
} from "../sdk/client";
import { emitSessionUpsert, emitSessionDelete } from "../runtime/broadcast";
import { SessionStream } from "../runtime/stream";
import { deleteUnreadState } from "./unread";
import { cleanupSessionAttachments } from "./attachments";
import {
  getSessionWorktree,
  upsertSessionWorktree,
  deleteSessionWorktree,
} from "./worktreeMetadata";
import { createWorktree, cleanupWorktree, detectGitRoot, getRepositoryName } from "../worktrees";

const activeSessions = new Map<string, CopilotSession>();

export type CreateSessionOptions = {
  model?: string;
  directory?: string;
  useWorktree?: boolean;
};

/** Create a new session with a specific ID and cache it (for draft sessions) */
export async function createSession(
  sessionId: string,
  options?: CreateSessionOptions,
): Promise<CopilotSession> {
  let { directory, model, useWorktree } = options ?? {};

  // If requested, create a git worktree and redirect the session into it.
  // Capture the original repo context so the initial SSE upsert shows the
  // correct repository name instead of the worktree hash.
  let originalGitRoot: string | undefined;
  let originalRepository: string | undefined;
  let worktreeRecord: { path: string; branch: string; baseBranch: string } | undefined;
  if (useWorktree && directory) {
    const gitRoot = await detectGitRoot(directory);
    if (gitRoot) {
      originalGitRoot = gitRoot;
      originalRepository = await getRepositoryName(gitRoot);

      const worktree = await createWorktree(gitRoot, sessionId);
      directory = worktree.path;

      worktreeRecord = {
        path: worktree.path,
        branch: worktree.branch,
        baseBranch: worktree.baseBranch,
      };
      await upsertSessionWorktree(sessionId, worktreeRecord);
    }
  }

  // The SDK requires a working directory. When none was explicitly provided
  // (e.g. automations with no cwd), fall back to the user's home directory
  // so the SDK has a valid path without leaking the server's cwd.
  const session = await sdkCreateSession(sessionId, model, directory ?? homedir());
  const now = new Date().toISOString();
  activeSessions.set(sessionId, session);

  // Emit immediately so the session appears in the list right away.
  // Only include context when a directory was explicitly provided —
  // sessions without a directory (e.g. automations) have no location.
  emitSessionUpsert({
    sessionId,
    startTime: now,
    modifiedTime: now,
    summary: "",
    isRemote: false,
    context: directory
      ? {
          cwd: directory,
          ...(originalGitRoot && { gitRoot: originalGitRoot }),
          ...(originalRepository && { repository: originalRepository }),
        }
      : undefined,
    worktree: worktreeRecord,
  });

  // Backfill full context (gitRoot, repository, branch) from the SDK's
  // session.start event once it's written to disk. Skip for directory-less
  // sessions — their events.jsonl contains the homedir fallback, not a
  // meaningful location the user chose.
  if (directory) {
    readSessionContextFromEvents(sessionId).then((context) => {
      if (context) {
        emitSessionUpsert({ sessionId, context });
      }
    });
  }
  return session;
}

/** Get a cached session or resume it from SDK persistence */
export async function getCachedOrResumeSession(sessionId: string): Promise<CopilotSession> {
  const cached = activeSessions.get(sessionId);
  if (cached) return cached;

  const session = await sdkResumeSession(sessionId);
  activeSessions.set(sessionId, session);
  return session;
}

function isSessionNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("session not found") ||
    message.includes("unknown session") ||
    message.includes("session file not found")
  );
}

/** Resume a session and fetch its messages, retrying once if the cached session is stale */
export async function getOrResumeSession(sessionId: string): Promise<{
  session: CopilotSession;
  events: Awaited<ReturnType<CopilotSession["getMessages"]>>;
}> {
  let session = await getCachedOrResumeSession(sessionId);
  try {
    const events = await session.getMessages();
    return { session, events };
  } catch (error) {
    if (!isSessionNotFoundError(error)) throw error;
    evictCachedSession(sessionId);

    session = await getCachedOrResumeSession(sessionId);
    const events = await session.getMessages();
    return { session, events };
  }
}

/** Remove a cached session so the next access forces a resume */
export function evictCachedSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

/** Check whether a session currently has a cached live SDK session object. */
export function hasCachedSession(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

/** Delete a session (worktree + cache + streaming + unread + attachments + SDK persistence) */
export async function deleteSession(sessionId: string): Promise<void> {
  // Clean up worktree if this was a worktree session
  const worktree = await getSessionWorktree(sessionId);
  if (worktree?.path && worktree.branch) {
    await cleanupWorktree({
      path: worktree.path,
      branch: worktree.branch,
    }).catch(console.error);
  }
  await deleteSessionWorktree(sessionId);

  const cached = activeSessions.get(sessionId);
  if (cached) {
    await cached.destroy();
    activeSessions.delete(sessionId);
  }

  SessionStream.remove(sessionId);
  deleteUnreadState(sessionId);

  await cleanupSessionAttachments(sessionId);
  await sdkDeleteSession(sessionId);
  emitSessionDelete(sessionId);
}
