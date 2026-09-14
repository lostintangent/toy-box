// Server-side SDK session registry and lifecycle coordination.
//
// The SDK persists sessions to disk; this module keeps live CopilotSession
// instances in memory, creates and resumes them with role-scoped tools, and
// coordinates lifecycle effects across runtime streams, workspace state,
// snapshots, worktrees, and SDK persistence.

import { homedir } from "node:os";
import type { CopilotSession, SessionContext } from "@github/copilot-sdk";
import {
  createDraftSession as sdkCreateDraftSession,
  createSession as sdkCreateSession,
  deleteSession as sdkDeleteSession,
  getSessionDirectory,
  readSessionContext,
  resumeSession as sdkResumeSession,
  setSessionWorkingDirectory as sdkSetSessionWorkingDirectory,
} from "../sdk/client";
import { getSessionConfiguration } from "@/server/sessionTools";
import {
  emitSessionDelete,
  emitSessionNameUpdate,
  emitSessionUpsert,
} from "@workspace/server/events";
import {
  addDraftSession,
  deleteSessionWorkspaceState,
  unpinSession,
} from "@workspace/server/state";
import { createSessionWorktree, deleteSessionWorktree } from "./worktrees";
import { deleteDraftSession, getDraftSession, persistDraftSession } from "./drafts";
import {
  deleteOwnedSessions,
  detachManagedSession,
  resolveSessionType,
} from "@/server/managedSessions";
import { sharedMap } from "@/shared/server/processState";
import { hasHyperSession } from "@workspace/server/state/hyperSessions";
import type { SessionType, SessionWorktree } from "@sessions/model";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";

// The SDK's automatic idle timeout can retire its server-side session while
// leaving subsequent resume unreliable. Explicit disconnect preserves durable
// history and gives the next acquisition a reliable resume boundary.
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

type CachedSession = {
  session: CopilotSession;
  configurationKey?: string;
  executionLease: boolean;
  idleReleaseTimer?: ReturnType<typeof setTimeout>;
  // SDK disconnect() does not return its in-flight promise to a second caller.
  disconnecting?: Promise<void>;
};
const cachedSessions = sharedMap<CachedSession>("configured-sessions");
// HMR can retain cached sessions created before lease metadata was introduced. Treat
// those conservatively as execution-owned until their stream releases them.
for (const cached of cachedSessions.values()) {
  cached.executionLease ??= true;
}
// Configuration refresh and cold resume are single-flight per session.
const sessionAcquisitions = sharedMap<Promise<CopilotSession>>("pending-session-resumes");

export type CreateSessionOptions = {
  model?: ModelConfiguration;
  name?: string;
  directory?: string;
  sessionType?: SessionType;
  useWorktree?: boolean;
  initialContext?: SessionContext;
  parentSessionId?: string;
};

// ── Creation ──────────────────────────────────────────────────────────

/** Create the SDK workspace now while retaining draft UX until the first message. */
export async function createDraftSession(
  sessionId: string,
  options: { artifact?: { path: string; content: string }; hyper?: true },
): Promise<void> {
  const artifact = options.artifact;

  await sdkCreateDraftSession(sessionId, artifact);
  const draft = {
    sessionId,
    createdAt: Date.now(),
    ...(artifact ? { artifactPath: artifact.path } : {}),
  };
  await persistDraftSession(draft);
  addDraftSession(draft, options.hyper);
}

/** Create and publish a new SDK session with a caller-provided ID. */
export async function createSession(
  sessionId: string,
  options?: CreateSessionOptions,
): Promise<{ session: CopilotSession; artifactPath?: string }> {
  const requested = options ?? {};
  const sessionType = options?.sessionType ?? (hasHyperSession(sessionId) ? "hyper" : "standard");
  const model = requested.model;
  const name = requested.name;
  const directory = requested.directory;
  const useWorktree = requested.useWorktree;
  const draft = await getDraftSession(sessionId);
  const { configurationKey, ...sessionConfiguration } = await getSessionConfiguration(
    sessionId,
    sessionType,
  );
  const { executionDirectory, displayContext, worktree } = await prepareSessionCreation(sessionId, {
    directory,
    useWorktree,
    initialContext: requested.initialContext,
  });

  // The SDK requires a working directory. When none was explicitly provided
  // (e.g. automations with no cwd), fall back to the user's home directory
  // so the SDK has a valid path without leaking the server's cwd.
  let session: CopilotSession | undefined;
  let sessionContext = displayContext;
  try {
    // Drafts temporarily use this same-ID create path. TODO: Resume the draft
    // directly when the Copilot SDK can resume a zero-turn session; today it
    // persists the workspace but no event history, so resume reports not found.
    session = await sdkCreateSession(sessionId, {
      model,
      directory: executionDirectory ?? homedir(),
      sessionType,
      ...sessionConfiguration,
      artifactPath: draft?.artifactPath,
    });
    if (draft && executionDirectory) {
      // Same-ID draft promotion no longer updates the SDK's persisted workspace metadata.
      sessionContext = await sdkSetSessionWorkingDirectory(session, executionDirectory);
    }
    if (draft?.artifactPath) {
      // Empty draft sessions persist their workspace but have no resumable
      // event log. Re-record the existing file after the first turn starts so
      // ordinary history projection owns artifact discovery from here on.
      const file = await session.rpc.workspaces.readFile({
        path: draft.artifactPath,
      });
      await session.rpc.workspaces.createFile({
        path: draft.artifactPath,
        content: file.content,
      });
    }
    if (name) await session.rpc.name.set({ name });
    if (draft) await deleteDraftSession(sessionId);
  } catch (error) {
    if (session) {
      if (draft) await session.disconnect().catch(console.error);
      else await sdkDeleteSession(sessionId).catch(console.error);
    }
    if (worktree) await deleteSessionWorktree(sessionId).catch(console.error);
    throw error;
  }
  const now = new Date().toISOString();
  cachedSessions.set(sessionId, { session, configurationKey, executionLease: true });

  // Emit immediately so the session appears in the list right away.
  // This display context can come from an inherited workspace or a
  // worktree rewrite; the SDK history remains the authoritative source once
  // session.start is written to disk.
  emitSessionUpsert({
    sessionId,
    startTime: now,
    modifiedTime: now,
    summary: name ?? "",
    isRemote: false,
    context: sessionContext,
    worktree,
    parentSessionId: requested.parentSessionId,
    sessionType,
  });

  // Backfill full context (gitRoot, repository, branch) from the SDK's
  // session.start event once it's written to disk. Skip for directory-less
  // sessions — their events.jsonl contains the homedir fallback, not a
  // meaningful location the user chose.
  if (!draft && executionDirectory) {
    void readSessionContext(sessionId).then((context) => {
      if (context) {
        emitSessionUpsert({ sessionId, context });
      }
    });
  }
  return {
    session,
    ...(draft?.artifactPath ? { artifactPath: draft.artifactPath } : {}),
  };
}

// ── SDK Sessions ───────────────────────────────────────────────────────

/** Acquire the SDK session owned by one execution, refreshing configuration when required. */
export async function acquireSession(sessionId: string): Promise<CopilotSession> {
  let cached = cachedSessions.get(sessionId);
  if (cached?.disconnecting) {
    await cached.disconnecting.catch(() => {});
    cached = cachedSessions.get(sessionId);
  }
  if (cached && cached.configurationKey === undefined) {
    cancelSessionRelease(cached);
    cached.executionLease = true;
    return cached.session;
  }

  const session = await acquireConfiguredSession(sessionId, cached);
  const acquired = cachedSessions.get(sessionId);
  if (acquired?.session === session) {
    cancelSessionRelease(acquired);
    acquired.executionLease = true;
  }
  return session;
}

async function acquireConfiguredSession(
  sessionId: string,
  cached?: CachedSession,
): Promise<CopilotSession> {
  let acquisition = sessionAcquisitions.get(sessionId);
  if (!acquisition) {
    acquisition = (async () => {
      const sessionType = await resolveSessionType(sessionId);
      const { configurationKey, ...sessionConfiguration } = await getSessionConfiguration(
        sessionId,
        sessionType,
      );
      if (cached && cached.configurationKey === configurationKey) return cached.session;

      if (cached) await disconnectCachedSession(sessionId, cached);
      const workspaceDirectory = await getSessionDirectory(sessionId);
      const directory = workspaceDirectory ?? homedir();
      const session = await sdkResumeSession(sessionId, {
        directory,
        sessionType,
        ...sessionConfiguration,
      });
      cachedSessions.set(sessionId, { session, configurationKey, executionLease: false });
      return session;
    })().finally(() => {
      sessionAcquisitions.delete(sessionId);
      const idle = cachedSessions.get(sessionId);
      if (idle) scheduleSessionRelease(sessionId, idle);
    });
    sessionAcquisitions.set(sessionId, acquisition);
  }

  return acquisition;
}

/** Release an execution-owned SDK session after its SessionStream finishes. */
export function releaseSession(sessionId: string): void {
  const cached = cachedSessions.get(sessionId);
  if (!cached) return;

  cached.executionLease = false;
  scheduleSessionRelease(sessionId, cached);
}

/** Disconnect an idle SDK session when a supervisor expects no immediate reuse. */
export async function releaseIdleSession(sessionId: string): Promise<void> {
  const cached = cachedSessions.get(sessionId);
  if (cached) await releaseCachedSessionIfIdle(sessionId, cached);
}

/**
 * Run a short SDK operation and retry once if it reveals a stale session.
 *
 * Use this for bounded calls such as history replay, rename, and rewind, not
 * for a SessionStream that owns one CopilotSession throughout execution. A
 * cached call retains its configuration; only execution acquisition refreshes it.
 */
export async function withSession<T>(
  sessionId: string,
  operation: (session: CopilotSession) => Promise<T>,
): Promise<T> {
  try {
    return await runSessionOperation(sessionId, operation);
  } catch (error) {
    if (!evictCachedSessionIfStale(sessionId, error)) throw error;

    return runSessionOperation(sessionId, operation);
  }
}

async function runSessionOperation<T>(
  sessionId: string,
  operation: (session: CopilotSession) => Promise<T>,
): Promise<T> {
  let cached = cachedSessions.get(sessionId);
  if (cached?.disconnecting) {
    await cached.disconnecting.catch(() => {});
    cached = cachedSessions.get(sessionId);
  }
  const session = cached?.session ?? (await acquireConfiguredSession(sessionId));
  const acquired = cachedSessions.get(sessionId);
  if (acquired?.session === session) cancelSessionRelease(acquired);

  try {
    return await operation(session);
  } finally {
    const current = cachedSessions.get(sessionId);
    if (current?.session === session) scheduleSessionRelease(sessionId, current);
  }
}

function evictCachedSession(sessionId: string): void {
  const cached = cachedSessions.get(sessionId);
  if (cached) cancelSessionRelease(cached);
  cachedSessions.delete(sessionId);
}

/** Drop a cached SDK session when an error says the SDK no longer knows
 *  the session, so the next access resumes fresh instead of reusing a stale
 *  instance. Returns whether the error was a stale-session error. */
export function evictCachedSessionIfStale(sessionId: string, error: unknown): boolean {
  if (!isSessionNotFoundError(error)) return false;

  evictCachedSession(sessionId);
  return true;
}

/** Rename a session through the SDK and broadcast the updated display name. */
export async function renameSession(sessionId: string, name: string): Promise<void> {
  await withSession(sessionId, (session) => session.rpc.name.set({ name }));
  emitSessionNameUpdate(sessionId, name);
}

/** Update an inferred title without replacing a name explicitly assigned by its creator or user. */
export async function updateSessionTitle(sessionId: string, title: string): Promise<boolean> {
  const result = await withSession(sessionId, (session) =>
    session.rpc.name.setAuto({ summary: title }),
  );
  return result.applied;
}

// ── Deletion ───────────────────────────────────────────────────────────

/** Delete a session and the complete tree of managed sessions it owns. */
export async function deleteSession(sessionId: string): Promise<void> {
  await deleteOwnedSessions(sessionId, deleteSession);
  await deleteSingleSession(sessionId);
}

/** Delete a session when present, while preserving real teardown failures. */
export async function deleteSessionIfExists(sessionId: string): Promise<boolean> {
  try {
    await deleteSession(sessionId);
    return true;
  } catch (error) {
    if (!evictCachedSessionIfStale(sessionId, error)) throw error;
    await removeDeletedSessionState(sessionId);
    return false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

async function deleteSingleSession(sessionId: string): Promise<void> {
  const cached = cachedSessions.get(sessionId);
  if (cached) cancelSessionRelease(cached);
  try {
    await sdkDeleteSession(sessionId);
  } catch (error) {
    if (cached) scheduleSessionRelease(sessionId, cached);
    throw error;
  }
  await removeDeletedSessionState(sessionId);
}

async function removeDeletedSessionState(sessionId: string): Promise<void> {
  await removeDeletedSessionStream(sessionId);

  const cached = cachedSessions.get(sessionId);
  if (cached) await disconnectCachedSession(sessionId, cached);
  await deleteSessionWorktree(sessionId);
  await deleteDraftSession(sessionId);
  await detachManagedSession(sessionId);
  await unpinSession(sessionId);
  deleteSessionWorkspaceState(sessionId);
  await evictDeletedSessionSnapshot(sessionId);
  emitSessionDelete(sessionId);
}

async function removeDeletedSessionStream(sessionId: string): Promise<void> {
  // Dynamic import keeps the registry from forming a static cycle with the
  // runtime stream, which imports this module to create and resume SDK sessions.
  const { SessionStream } = await import("../runtime/sessionStream");
  SessionStream.remove(sessionId);
}

async function evictDeletedSessionSnapshot(sessionId: string): Promise<void> {
  // Snapshots use withSession from this module; importing lazily keeps that
  // dependency one-way during module initialization.
  const { evictCachedSnapshot } = await import("./snapshots");
  evictCachedSnapshot(sessionId);
}

async function releaseCachedSessionIfIdle(sessionId: string, cached: CachedSession): Promise<void> {
  if (
    cachedSessions.get(sessionId) !== cached ||
    cached.executionLease ||
    sessionAcquisitions.has(sessionId)
  ) {
    return;
  }

  await disconnectCachedSession(sessionId, cached);
}

function scheduleSessionRelease(sessionId: string, cached: CachedSession): void {
  cancelSessionRelease(cached);
  if (cached.executionLease || cached.disconnecting) return;

  cached.idleReleaseTimer = setTimeout(() => {
    cached.idleReleaseTimer = undefined;
    void releaseCachedSessionIfIdle(sessionId, cached).catch((error) => {
      console.error(`Unable to release idle session ${sessionId}:`, error);
    });
  }, SESSION_IDLE_TIMEOUT_MS);
  cached.idleReleaseTimer.unref();
}

function cancelSessionRelease(cached: CachedSession): void {
  if (!cached.idleReleaseTimer) return;
  clearTimeout(cached.idleReleaseTimer);
  cached.idleReleaseTimer = undefined;
}

function disconnectCachedSession(sessionId: string, cached: CachedSession): Promise<void> {
  if (cached.disconnecting) return cached.disconnecting;

  cancelSessionRelease(cached);
  const disconnecting = cached.session.disconnect().then(
    () => {
      if (cachedSessions.get(sessionId) === cached) cachedSessions.delete(sessionId);
    },
    (error) => {
      if (cachedSessions.get(sessionId) === cached) {
        cached.disconnecting = undefined;
        scheduleSessionRelease(sessionId, cached);
      }
      throw error;
    },
  );
  cached.disconnecting = disconnecting;
  return disconnecting;
}

type PreparedSessionCreation = {
  executionDirectory?: string;
  displayContext?: SessionContext;
  worktree?: SessionWorktree;
};

async function prepareSessionCreation(
  sessionId: string,
  options: Pick<CreateSessionOptions, "directory" | "useWorktree" | "initialContext">,
): Promise<PreparedSessionCreation> {
  const requestedDirectory = options.directory;
  let executionDirectory = requestedDirectory;
  let sourceGitRoot: string | undefined;
  let sourceRepository: string | undefined;
  let worktree: SessionWorktree | undefined;

  if (options.useWorktree && requestedDirectory) {
    const created = await createSessionWorktree(sessionId, requestedDirectory);
    if (created) {
      sourceGitRoot = created.sourceGitRoot;
      sourceRepository = created.sourceRepository;
      executionDirectory = created.worktree.path;
      worktree = created.worktree;
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
    worktree,
  };
}

export function isSessionNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("session not found") ||
    message.includes("unknown session") ||
    message.includes("session file not found")
  );
}
