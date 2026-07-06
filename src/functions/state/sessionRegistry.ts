// Server-side SDK session registry and lifecycle coordination.
//
// The SDK persists sessions to disk; this module keeps live CopilotSession
// handles in memory, resumes them single-flight, and coordinates create/delete
// side effects across runtime streams, unread state, snapshots, worktrees, and
// SDK persistence.

import { homedir } from "node:os";
import type { CopilotSession, SessionContext } from "@github/copilot-sdk";
import {
  createSession as sdkCreateSession,
  resumeSession as sdkResumeSession,
  deleteSession as sdkDeleteSession,
  readSessionContextFromEvents,
  getSessionScope,
} from "../sdk/client";
import { getTools } from "../sdk/tools";
import { emitSessionUpsert, emitSessionDelete, updateSessionName } from "../runtime/broadcast";
import { deleteDraftState, deleteSessionWorkspaceState } from "./workspace";
import { evictCachedSnapshot } from "./snapshotCache";
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
import { sharedMap } from "../runtime/processState";
import { getAutomationIdFromSessionId } from "@/lib/automation/sessionId";
import type { ModelConfiguration, SessionWorktree } from "@/types";

const cachedSessions = sharedMap<CopilotSession>("active-sessions");
// In-flight resumes share one SDK handle per session ID.
const pendingResumes = sharedMap<Promise<CopilotSession>>("pending-session-resumes");

export type CreateSessionOptions = {
  modelConfiguration?: ModelConfiguration;
  directory?: string;
  automationId?: string;
  useWorktree?: boolean;
  initialContext?: SessionContext;
  parentSessionId?: string;
};

type PreparedSessionCreation = {
  executionDirectory?: string;
  displayContext?: SessionContext;
  worktreeRecord?: SessionWorktree;
};

// ── Creation ──────────────────────────────────────────────────────────

/** Create a new session with a specific ID and cache it (for draft sessions) */
export async function createSession(
  sessionId: string,
  options?: CreateSessionOptions,
): Promise<CopilotSession> {
  const {
    modelConfiguration,
    directory,
    automationId,
    useWorktree,
    initialContext,
    parentSessionId,
  } = options ?? {};
  const { executionDirectory, displayContext, worktreeRecord } = await prepareSessionCreation(
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
  const session = await sdkCreateSession(sessionId, {
    modelConfiguration,
    directory: executionDirectory ?? homedir(),
    automationId,
    tools: getTools({ scope: executionDirectory ? "directory" : "user" }),
  });
  const now = new Date().toISOString();
  cachedSessions.set(sessionId, session);
  deleteDraftState(sessionId);

  if (parentSessionId) {
    await upsertChildSession(sessionId, parentSessionId);
  }

  // Emit immediately so the session appears in the list right away.
  // This display context can come from an inherited workspace or a
  // worktree rewrite; the SDK history remains the authoritative source once
  // session.start is written to disk.
  emitSessionUpsert({
    sessionId,
    startTime: now,
    modifiedTime: now,
    summary: "",
    isRemote: false,
    context: displayContext,
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

// ── SDK Sessions ───────────────────────────────────────────────────────

/**
 * Get the live CopilotSession for long-lived owners such as SessionStream.
 *
 * This does not probe the session. Short SDK calls should use
 * withSession so stale-handle retry stays centralized.
 */
export function getSession(sessionId: string): Promise<CopilotSession> {
  const cached = cachedSessions.get(sessionId);
  if (cached) return Promise.resolve(cached);

  const pending = pendingResumes.get(sessionId);
  if (pending) return pending;

  const resume = (async () => {
    const session = await sdkResumeSession(
      sessionId,
      getTools({ scope: await getSessionScope(sessionId) }),
      getAutomationIdFromSessionId(sessionId) ?? undefined,
    );
    cachedSessions.set(sessionId, session);
    return session;
  })().finally(() => {
    pendingResumes.delete(sessionId);
  });
  pendingResumes.set(sessionId, resume);
  return resume;
}

/**
 * Run a short SDK operation and retry once if it reveals a stale session.
 *
 * Use this for calls like getEvents() or rpc.skills.list(), not for streams
 * that need to keep one subscribed CopilotSession alive.
 */
export async function withSession<T>(
  sessionId: string,
  operation: (session: CopilotSession) => Promise<T>,
): Promise<T> {
  let session = await getSession(sessionId);
  try {
    return await operation(session);
  } catch (error) {
    if (!evictCachedSessionIfStale(sessionId, error)) throw error;

    session = await getSession(sessionId);
    return await operation(session);
  }
}

/** Remove a cached session so the next access forces a resume */
export function evictCachedSession(sessionId: string): void {
  cachedSessions.delete(sessionId);
}

/** Drop a cached session handle when an error says the SDK no longer knows
 *  the session, so the next access resumes fresh instead of reusing a stale
 *  handle. Returns whether the error was a stale-session error. */
export function evictCachedSessionIfStale(sessionId: string, error: unknown): boolean {
  if (!isSessionNotFoundError(error)) return false;

  evictCachedSession(sessionId);
  return true;
}

/** Check whether a session currently has a cached live SDK session object. */
export function hasCachedSession(sessionId: string): boolean {
  return cachedSessions.has(sessionId);
}

/** Rename a session through the SDK and broadcast the updated display name. */
export async function renameSession(sessionId: string, name: string): Promise<void> {
  await withSession(sessionId, (session) => session.rpc.name.set({ name }));
  updateSessionName(sessionId, name);
}

// ── Deletion ───────────────────────────────────────────────────────────

/** Delete a session and its direct child sessions. */
export async function deleteSession(sessionId: string): Promise<void> {
  const childSessionIds = await getChildSessionIdsForParent(sessionId);
  for (const childSessionId of childSessionIds) {
    await deleteSingleSession(childSessionId);
  }

  await deleteSingleSession(sessionId);
}

// ── Helpers ────────────────────────────────────────────────────────────

async function deleteSingleSession(sessionId: string): Promise<void> {
  const worktree = await getSessionWorktree(sessionId);

  await sdkDeleteSession(sessionId);
  await removeDeletedSessionStream(sessionId);

  const cached = cachedSessions.get(sessionId);
  if (cached) {
    await cached.disconnect();
    cachedSessions.delete(sessionId);
  }

  if (worktree) {
    await cleanupWorktree({
      path: worktree.path,
      branch: worktree.branch,
    }).catch(console.error);
  }
  await deleteSessionWorktree(sessionId);
  await deleteChildSession(sessionId);
  deleteSessionWorkspaceState(sessionId);
  evictCachedSnapshot(sessionId);
  emitSessionDelete(sessionId);
}

async function removeDeletedSessionStream(sessionId: string): Promise<void> {
  // Dynamic import keeps the registry from forming a static cycle with the
  // runtime stream, which imports this module to create and resume SDK sessions.
  const { SessionStream } = await import("../runtime/stream");
  SessionStream.remove(sessionId);
}

async function prepareSessionCreation(
  sessionId: string,
  options: Pick<CreateSessionOptions, "directory" | "useWorktree" | "initialContext">,
): Promise<PreparedSessionCreation> {
  const requestedDirectory = options.directory;
  let executionDirectory = requestedDirectory;
  let sourceGitRoot: string | undefined;
  let sourceRepository: string | undefined;
  let worktreeRecord: SessionWorktree | undefined;

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

  let displayContext: SessionContext | undefined;
  if (executionDirectory) {
    displayContext = { workingDirectory: executionDirectory };

    const gitRoot = sourceGitRoot ?? options.initialContext?.gitRoot;
    if (gitRoot) displayContext.gitRoot = gitRoot;

    const repository = sourceRepository ?? options.initialContext?.repository;
    if (repository) displayContext.repository = repository;

    // Worktree sessions display their synthetic branch from worktree metadata,
    // not from the source session's branch.
    if (!options.useWorktree && options.initialContext?.branch) {
      displayContext.branch = options.initialContext.branch;
    }
  }

  return {
    executionDirectory,
    displayContext,
    worktreeRecord,
  };
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
