// Server-side SDK session registry and lifecycle coordination.
//
// The SDK persists sessions to disk; this module keeps live CopilotSession
// handles in memory, creates and resumes them with role-scoped tools, and
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
} from "../sdk/client";
import { getSessionTools } from "@/server/sessionTools";
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
  getWorkerAppId,
  getWorkerSessionIdsForParent,
  registerWorkerSession,
  unregisterWorkerSession,
} from "@workers/server/database";
import { sharedMap } from "@/shared/server/processState";
import { hasHyperSession } from "@workspace/server/state/hyperSessions";
import { resolveSessionType } from "./sessionType";
import { workerParentSessionId } from "@workers/model";
import type { SessionType, SessionWorktree } from "@sessions/model";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";
import type { Worker } from "@workers/model";

const cachedSessions = sharedMap<CopilotSession>("active-sessions");
// In-flight resumes share one SDK handle per session ID.
const pendingResumes = sharedMap<Promise<CopilotSession>>("pending-session-resumes");

export type CreateSessionOptions = {
  model?: ModelConfiguration;
  name?: string;
  directory?: string;
  sessionType?: SessionType;
  useWorktree?: boolean;
  initialContext?: SessionContext;
  worker?: Worker;
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
  const sessionType =
    options?.sessionType ??
    (requested.worker ? "worker" : hasHyperSession(sessionId) ? "hyper" : "standard");
  const worker = requested.worker;
  const model = requested.model;
  const name = requested.name;
  const directory = requested.directory;
  const useWorktree = requested.useWorktree;
  const parentSessionId = worker ? workerParentSessionId(worker) : undefined;
  if ((sessionType === "worker") !== Boolean(worker)) {
    throw new Error("Worker session creation requires exactly one worker owner.");
  }
  if (worker && worker.sessionId !== sessionId) {
    throw new Error("Worker session creation requires matching session IDs.");
  }
  const draft = await getDraftSession(sessionId);
  const { executionDirectory, displayContext, worktree } = await prepareSessionCreation(sessionId, {
    directory,
    useWorktree,
    initialContext: requested.initialContext,
  });

  // The SDK requires a working directory. When none was explicitly provided
  // (e.g. automations with no cwd), fall back to the user's home directory
  // so the SDK has a valid path without leaking the server's cwd.
  let session: CopilotSession | undefined;
  try {
    if (worker) {
      await registerWorkerSession(worker);
    }
    // Drafts temporarily use this same-ID create path. TODO: Resume the draft
    // directly when the Copilot SDK can resume a zero-turn session; today it
    // persists the workspace but no event history, so resume reports not found.
    session = await sdkCreateSession(sessionId, {
      model,
      directory: executionDirectory ?? homedir(),
      sessionType,
      tools: getSessionTools(sessionType, worker?.type === "app" ? worker.appId : undefined),
      artifactPath: draft?.artifactPath,
    });
    if (draft?.artifactPath) {
      // Empty draft sessions persist their workspace but have no resumable
      // event log. Re-record the existing file after the first turn starts so
      // ordinary history projection owns artifact discovery from here on.
      const file = await session.rpc.workspaces.readFile({ path: draft.artifactPath });
      await session.rpc.workspaces.createFile({ path: draft.artifactPath, content: file.content });
    }
    if (name) await session.rpc.name.setAuto({ summary: name });
    if (draft) await deleteDraftSession(sessionId);
  } catch (error) {
    if (session) {
      if (draft) await session.disconnect().catch(console.error);
      else await sdkDeleteSession(sessionId).catch(console.error);
    }
    if (worker) {
      await unregisterWorkerSession(sessionId).catch(console.error);
    }
    if (worktree) await deleteSessionWorktree(sessionId).catch(console.error);
    throw error;
  }
  const now = new Date().toISOString();
  cachedSessions.set(sessionId, session);

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
    context: displayContext,
    worktree,
    parentSessionId,
    sessionType,
  });

  // Backfill full context (gitRoot, repository, branch) from the SDK's
  // session.start event once it's written to disk. Skip for directory-less
  // sessions — their events.jsonl contains the homedir fallback, not a
  // meaningful location the user chose.
  if (executionDirectory) {
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
    const [workspaceDirectory, sessionType] = await Promise.all([
      getSessionDirectory(sessionId),
      resolveSessionType(sessionId),
    ]);
    const appId = sessionType === "worker" ? await getWorkerAppId(sessionId) : undefined;
    const directory = workspaceDirectory ?? homedir();
    const session = await sdkResumeSession(sessionId, {
      directory,
      sessionType,
      tools: getSessionTools(sessionType, appId),
    });
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

function evictCachedSession(sessionId: string): void {
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

/** Rename a session through the SDK and broadcast the updated display name. */
export async function renameSession(sessionId: string, name: string): Promise<void> {
  await withSession(sessionId, (session) => session.rpc.name.set({ name }));
  emitSessionNameUpdate(sessionId, name);
}

// ── Deletion ───────────────────────────────────────────────────────────

/** Delete a session and the complete tree of workers it owns. */
export async function deleteSession(sessionId: string): Promise<void> {
  const workerSessionIds = await getWorkerSessionIdsForParent(sessionId);
  for (const workerSessionId of workerSessionIds) {
    await deleteSession(workerSessionId);
  }

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
  await sdkDeleteSession(sessionId);
  await removeDeletedSessionState(sessionId);
}

async function removeDeletedSessionState(sessionId: string): Promise<void> {
  await removeDeletedSessionStream(sessionId);

  const cached = cachedSessions.get(sessionId);
  if (cached) {
    await cached.disconnect();
    cachedSessions.delete(sessionId);
  }

  await deleteSessionWorktree(sessionId);
  await deleteDraftSession(sessionId);
  await unregisterWorkerSession(sessionId);
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

function isSessionNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("session not found") ||
    message.includes("unknown session") ||
    message.includes("session file not found")
  );
}
