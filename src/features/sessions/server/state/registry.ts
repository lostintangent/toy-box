// Server-side provider session registry and lifecycle coordination.
//
// Providers persist native history; this module keeps live SessionConnection
// instances in memory, creates and resumes them with role-scoped tools, and
// coordinates lifecycle effects across runtime streams, workspace state,
// snapshots, worktrees, and provider persistence.

import { homedir } from "node:os";
import type { SessionConnection } from "@providers/server/provider";
import { SessionConnectionUnavailableError } from "@providers/server/provider";
import { ensureSessionFiles, writeSessionArtifact, deleteSessionFiles } from "../artifacts";
import {
  createSession as createProviderSession,
  deleteSession as deleteProviderSession,
  getSessionDirectory,
  resumeSession as resumeProviderSession,
} from "../providers";
import { getSessionConfiguration } from "@/server/sessionConfiguration";
import {
  emitSessionDelete,
  emitSessionNameUpdate,
  emitSessionUpsert,
} from "@workspace/server/events";
import { deleteSessionWorkspaceState, unpinSession } from "@workspace/server/state";
import { createSessionWorktree, deleteSessionWorktree } from "./worktrees";
import { deleteSessionRecord, readSession, insertSession } from "./sessions";
import {
  deleteOwnedSessions,
  detachManagedSession,
  resolveSessionType,
} from "@/server/managedSessions";
import { sharedMap } from "@/shared/server/processState";
import { addHyperSession, hasHyperSession } from "@workspace/server/state/hyperSessions";
import type { SessionType } from "@sessions/model";
import type { ModelConfiguration } from "@providers/model";

// Release idle native connections explicitly while preserving durable history.
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

type CachedSession = {
  session: SessionConnection;
  configurationKey?: string;
  executionLease: boolean;
  idleReleaseTimer?: ReturnType<typeof setTimeout>;
  // Join the same teardown when acquisitions and release overlap.
  disconnecting?: Promise<void>;
};
const cachedSessions = sharedMap<CachedSession>("configured-sessions");
// Configuration refresh and cold resume are single-flight per session.
const sessionAcquisitions = sharedMap<Promise<SessionConnection>>("pending-session-resumes");

export type CreateSessionOptions = {
  model?: ModelConfiguration;
  name?: string;
  directory?: string;
  sessionType?: SessionType;
  useWorktree?: boolean;
  parentSessionId?: string;
};

// ── Creation ──────────────────────────────────────────────────────────

/** Claim public identity before creating any files or selecting a provider. */
export async function createSessionRecord(
  sessionId: string,
  options: {
    artifact?: { path: string; content: string };
    hyper?: true;
    sessionType?: SessionType;
    title?: string;
  },
): Promise<void> {
  const artifact = options.artifact;
  const sessionType = options.sessionType ?? (options.hyper ? "hyper" : "standard");

  const createdAt = new Date();
  const record = {
    id: sessionId,
    createdAt,
    ...(artifact ? { artifactPath: artifact.path } : {}),
  };
  await insertSession(record);
  try {
    await ensureSessionFiles(sessionId);
    if (artifact) await writeSessionArtifact(sessionId, artifact.path, artifact.content);
  } catch (error) {
    await deleteSessionRecord(sessionId);
    throw error;
  }
  if (options.hyper) addHyperSession(sessionId);
  emitSessionUpsert({
    ...record,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    title: options.title,
    sessionType,
  });
}

/** Create and publish a new provider session with a caller-provided ID. */
export async function createSession(
  sessionId: string,
  options?: CreateSessionOptions,
): Promise<{ session: SessionConnection; artifactPath?: string }> {
  const requested = options ?? {};
  const sessionType = options?.sessionType ?? (hasHyperSession(sessionId) ? "hyper" : "standard");
  const model = requested.model;
  const name = requested.name;
  const directory = requested.directory;
  const useWorktree = requested.useWorktree;
  const record = await readSession(sessionId);
  const { configurationKey, ...sessionConfiguration } = await getSessionConfiguration(
    sessionId,
    sessionType,
  );
  const worktree =
    directory && useWorktree ? await createSessionWorktree(sessionId, directory) : undefined;
  const executionDirectory = worktree?.path ?? directory;

  // Providers require a working directory. When none was explicitly provided
  // (e.g. automations with no cwd), fall back to the user's home directory
  // so the provider has a valid path without leaking the server's cwd.
  let session: SessionConnection;
  try {
    await ensureSessionFiles(sessionId);
    session = await createProviderSession(sessionId, {
      model,
      name,
      directory: executionDirectory ?? homedir(),
      sessionType,
      ...sessionConfiguration,
      artifactPath: record?.artifactPath,
    });
  } catch (error) {
    if (worktree) await deleteSessionWorktree(sessionId).catch(console.error);
    throw error;
  }
  const now = new Date().toISOString();
  cachedSessions.set(sessionId, { session, configurationKey, executionLease: true });

  // Publish the execution directory immediately so clients can resolve its location.
  emitSessionUpsert({
    id: sessionId,
    provider: {
      id: session.provider.id,
      ...(session.provider.sessionId && session.provider.sessionId !== sessionId
        ? { sessionId: session.provider.sessionId }
        : {}),
    },
    createdAt: record?.createdAt.toISOString() ?? now,
    updatedAt: now,
    title: name ?? "",
    context: { directory: executionDirectory },
    worktree,
    parentSessionId: requested.parentSessionId,
    sessionType,
  });

  return {
    session,
    ...(record?.artifactPath ? { artifactPath: record.artifactPath } : {}),
  };
}

// ── Provider connections ───────────────────────────────────────────────────────

/** Acquire the provider session owned by one execution, refreshing configuration when required. */
export async function acquireSession(sessionId: string): Promise<SessionConnection> {
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
): Promise<SessionConnection> {
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
      const session = await resumeProviderSession(sessionId, {
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

/** Release an execution-owned provider session after its SessionStream finishes. */
export function releaseSession(sessionId: string): void {
  const cached = cachedSessions.get(sessionId);
  if (!cached) return;

  cached.executionLease = false;
  scheduleSessionRelease(sessionId, cached);
}

/** Disconnect an idle provider session when a supervisor expects no immediate reuse. */
export async function releaseIdleSession(sessionId: string): Promise<void> {
  const cached = cachedSessions.get(sessionId);
  if (cached) await releaseCachedSessionIfIdle(sessionId, cached);
}

/**
 * Run a short provider operation and retry once if it reveals a stale session.
 *
 * Use this for bounded calls such as history replay, rename, and rewind, not
 * for a SessionStream that owns one SessionConnection throughout execution. A
 * cached call retains its configuration; only execution acquisition refreshes it.
 */
export async function withSession<T>(
  sessionId: string,
  operation: (session: SessionConnection) => Promise<T>,
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
  operation: (session: SessionConnection) => Promise<T>,
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
  if (cached) void cached.session.disconnect().catch(console.error);
}

/** Drop a cached provider session when an error says the provider no longer knows
 *  the session, so the next access resumes fresh instead of reusing a stale
 *  instance. Returns whether the error was a stale-session error. */
export function evictCachedSessionIfStale(sessionId: string, error: unknown): boolean {
  if (!(error instanceof SessionConnectionUnavailableError) && !isSessionNotFoundError(error))
    return false;

  evictCachedSession(sessionId);
  return true;
}

/** Rename a session through its provider and broadcast the updated display name. */
export async function renameSession(sessionId: string, name: string): Promise<void> {
  await withSession(sessionId, (session) => session.rename(name));
  emitSessionNameUpdate(sessionId, name);
}

/** Update an inferred title without replacing a name explicitly assigned by its creator or user. */
export async function updateSessionTitle(sessionId: string, title: string): Promise<boolean> {
  const applied = await withSession(sessionId, (session) => session.rename(title, true));
  if (applied) emitSessionNameUpdate(sessionId, title);
  return applied;
}

// ── Deletion ───────────────────────────────────────────────────────────

/** Delete a session and the complete tree of managed sessions it owns. */
export async function deleteSession(
  sessionId: string,
  options?: { publish?: boolean },
): Promise<void> {
  await deleteOwnedSessions(sessionId);
  await removeSessionRuntime(sessionId);
  const record = await readSession(sessionId);
  if (!record || record.provider) await deleteProviderSession(sessionId);
  await removeDeletedSessionState(sessionId, options);
}

/** Delete a session when present, while preserving real teardown failures. */
export async function deleteSessionIfExists(
  sessionId: string,
  options?: { publish?: boolean },
): Promise<boolean> {
  try {
    await deleteSession(sessionId, options);
    return true;
  } catch (error) {
    if (!evictCachedSessionIfStale(sessionId, error)) throw error;
    await removeSessionRuntime(sessionId);
    await removeDeletedSessionState(sessionId, options);
    return false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

async function removeDeletedSessionState(
  sessionId: string,
  { publish = true }: { publish?: boolean } = {},
): Promise<void> {
  await deleteSessionWorktree(sessionId);
  await deleteSessionFiles(sessionId);
  await deleteSessionRecord(sessionId);
  await detachManagedSession(sessionId);
  await unpinSession(sessionId);
  deleteSessionWorkspaceState(sessionId);
  await evictDeletedSessionSnapshot(sessionId);
  if (publish) emitSessionDelete(sessionId);
}

async function removeSessionRuntime(sessionId: string): Promise<void> {
  // Dynamic import keeps the registry from forming a static cycle with the
  // runtime stream, which imports this module to create and resume provider sessions.
  const { SessionStream } = await import("../runtime/sessionStream");
  await SessionStream.remove(sessionId);
  // Native teardown can flush history; it must finish before history is deleted.
  const cached = cachedSessions.get(sessionId);
  if (cached) await disconnectCachedSession(sessionId, cached);
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

export function isSessionNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("session not found") ||
    message.includes("unknown session") ||
    message.includes("session file not found") ||
    message.includes("thread not found") ||
    message.includes("no rollout found")
  );
}
