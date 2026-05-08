// CopilotSession object cache and session lifecycle orchestration.
//
// The SDK persists sessions to disk; this module caches live
// CopilotSession objects in memory to avoid redundant resume calls.
// It also owns the deleteSession workflow, which coordinates cleanup
// across streaming buffers, unread state, attachments, and SDK
// persistence.

import { homedir } from "node:os";
import type { CopilotSession, SessionContext } from "@github/copilot-sdk";
import {
  createSession as sdkCreateSession,
  resumeSession as sdkResumeSession,
  deleteSession as sdkDeleteSession,
  readSessionContextFromEvents,
} from "../sdk/client";
import { getTools } from "../sdk/tools";
import { emitSessionUpsert, emitSessionDelete } from "../runtime/broadcast";
import { SessionStream } from "../runtime/stream";
import { deleteUnreadState } from "./unread";
import { cleanupSessionAttachments } from "./attachments";
import {
  getSessionWorktree,
  upsertSessionWorktree,
  deleteSessionWorktree,
} from "./worktreeMetadata";
import {
  deleteChildSession,
  getChildSessionIdsForParent,
  upsertChildSession,
} from "./childSessions";
import { createWorktree, cleanupWorktree, detectGitRoot, getRepositoryName } from "../worktrees";

const activeSessions = new Map<string, CopilotSession>();

export type CreateSessionOptions = {
  model?: string;
  directory?: string;
  useWorktree?: boolean;
  initialContext?: SessionContext;
  parentSessionId?: string;
};

type SessionWorktreeRecord = {
  path: string;
  branch: string;
  baseBranch: string;
};

type MergedDisplayContextOptions = {
  executionDirectory?: string;
  initialContext?: SessionContext;
  sourceGitRoot?: string;
  sourceRepository?: string;
  useWorktree?: boolean;
};

type PreparedSessionLocation = {
  executionDirectory?: string;
  mergedDisplayContext?: SessionContext;
  worktreeRecord?: SessionWorktreeRecord;
};

function buildMergedDisplayContext(
  options: MergedDisplayContextOptions,
): SessionContext | undefined {
  if (!options.executionDirectory) return undefined;

  return {
    workingDirectory: options.executionDirectory,
    ...(options.initialContext?.gitRoot && { gitRoot: options.initialContext.gitRoot }),
    ...(options.initialContext?.repository && { repository: options.initialContext.repository }),
    ...(options.initialContext?.branch &&
      !options.useWorktree && { branch: options.initialContext.branch }),
    ...(options.sourceGitRoot && { gitRoot: options.sourceGitRoot }),
    ...(options.sourceRepository && { repository: options.sourceRepository }),
  };
}

async function prepareSessionLocation(
  sessionId: string,
  options: Pick<CreateSessionOptions, "directory" | "useWorktree" | "initialContext">,
): Promise<PreparedSessionLocation> {
  const requestedDirectory = options.directory;
  let executionDirectory = requestedDirectory;
  let sourceGitRoot: string | undefined;
  let sourceRepository: string | undefined;
  let worktreeRecord: SessionWorktreeRecord | undefined;

  if (options.useWorktree && requestedDirectory) {
    const gitRoot = await detectGitRoot(requestedDirectory);
    if (gitRoot) {
      sourceGitRoot = gitRoot;
      sourceRepository = await getRepositoryName(gitRoot);

      const worktree = await createWorktree(gitRoot, sessionId);
      executionDirectory = worktree.path;

      worktreeRecord = {
        path: worktree.path,
        branch: worktree.branch,
        baseBranch: worktree.baseBranch,
      };
      await upsertSessionWorktree(sessionId, worktreeRecord);
    }
  }

  return {
    executionDirectory,
    mergedDisplayContext: buildMergedDisplayContext({
      executionDirectory,
      initialContext: options.initialContext,
      sourceGitRoot,
      sourceRepository,
      useWorktree: options.useWorktree,
    }),
    worktreeRecord,
  };
}

/** Create a new session with a specific ID and cache it (for draft sessions) */
export async function createSession(
  sessionId: string,
  options?: CreateSessionOptions,
): Promise<CopilotSession> {
  const { model, directory, useWorktree, initialContext, parentSessionId } = options ?? {};
  const { executionDirectory, mergedDisplayContext, worktreeRecord } = await prepareSessionLocation(
    sessionId,
    {
      directory,
      useWorktree,
      initialContext,
    },
  );

  // The SDK requires a working directory. When none was explicitly provided
  // (e.g. automations with no cwd), fall back to the user's home directory
  // so the SDK has a valid path without leaking the server's cwd.
  const session = await sdkCreateSession(
    sessionId,
    model,
    executionDirectory ?? homedir(),
    getTools(),
  );
  const now = new Date().toISOString();
  activeSessions.set(sessionId, session);

  if (parentSessionId) {
    await upsertChildSession(sessionId, parentSessionId);
  }

  // Emit immediately so the session appears in the list right away.
  // This merged display context can come from an inherited workspace or a
  // worktree rewrite; the SDK history remains the authoritative source once
  // session.start is written to disk.
  emitSessionUpsert({
    sessionId,
    startTime: now,
    modifiedTime: now,
    summary: "",
    isRemote: false,
    context: mergedDisplayContext,
    worktree: worktreeRecord,
    parentSessionId,
  });

  // Backfill full context (gitRoot, repository, branch) from the SDK's
  // session.start event once it's written to disk. Skip for directory-less
  // sessions — their events.jsonl contains the homedir fallback, not a
  // meaningful location the user chose.
  if (executionDirectory) {
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

  const session = await sdkResumeSession(sessionId, getTools());
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
  events: Awaited<ReturnType<CopilotSession["getEvents"]>>;
}> {
  let session = await getCachedOrResumeSession(sessionId);
  try {
    const events = await session.getEvents();
    return { session, events };
  } catch (error) {
    if (!isSessionNotFoundError(error)) throw error;
    evictCachedSession(sessionId);

    session = await getCachedOrResumeSession(sessionId);
    const events = await session.getEvents();
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

async function deleteSessionRecord(sessionId: string): Promise<void> {
  // Clean up worktree if this was a worktree session
  const worktree = await getSessionWorktree(sessionId);
  if (worktree?.path && worktree.branch) {
    await cleanupWorktree({
      path: worktree.path,
      branch: worktree.branch,
    }).catch(console.error);
  }
  await deleteSessionWorktree(sessionId);
  await deleteChildSession(sessionId);

  const cached = activeSessions.get(sessionId);
  if (cached) {
    await cached.disconnect();
    activeSessions.delete(sessionId);
  }

  SessionStream.remove(sessionId);
  deleteUnreadState(sessionId);

  await cleanupSessionAttachments(sessionId);
  await sdkDeleteSession(sessionId);
  emitSessionDelete(sessionId);
}

/** Delete a session and its direct child sessions. */
export async function deleteSession(sessionId: string): Promise<void> {
  const childSessionIds = await getChildSessionIdsForParent(sessionId);
  for (const childSessionId of childSessionIds) {
    await deleteSessionRecord(childSessionId);
  }

  await deleteSessionRecord(sessionId);
}
