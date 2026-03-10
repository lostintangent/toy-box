// Copilot SDK client — singleton initialization and SDK operations
// This file should only be imported from server-side code

import { CopilotClient } from "@github/copilot-sdk";
import type {
  CopilotSession,
  PermissionHandler,
  SessionContext,
  SessionMetadata,
} from "@github/copilot-sdk";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

// ============================================================================
// CLI Path Resolution
// ============================================================================

/**
 * Resolve the CLI path passed to CopilotClient.
 *
 * In development, let the SDK resolve its own bundled CLI path.
 * In production (compiled binary), resolve the globally installed `copilot`
 * executable from PATH and pass it explicitly.
 */
function resolveCopilotCliPath(): string | undefined {
  // In dev, the SDK's default import.meta.resolve works fine
  if (import.meta.env.DEV) return;

  // Find the globally installed `copilot` binary on PATH.
  try {
    const copilotBin = Bun.which("copilot");
    if (copilotBin) {
      // Prefer the resolved path when `copilot` is a symlink (common in npm global installs).
      // If realpath resolution fails, the original executable path is still usable.
      try {
        return realpathSync(copilotBin);
      } catch {
        return copilotBin;
      }
    }
  } catch {
    // PATH lookup failed — fall through
  }

  throw new Error(
    "Could not find `copilot` on PATH. Install it globally with `npm i -g @github/copilot`.",
  );
}

// ============================================================================
// Singleton Client
// ============================================================================

let copilotClientPromise: Promise<CopilotClient> | undefined;

function getCopilotClient(): Promise<CopilotClient> {
  if (!copilotClientPromise) {
    copilotClientPromise = (async () => {
      try {
        const cliPath = resolveCopilotCliPath();
        const client = new CopilotClient({
          // Provide an explicit CLI path so the SDK doesn't rely on
          // import.meta.resolve, which fails in compiled Bun binaries when
          // run from a directory without @github/copilot in node_modules.
          ...(cliPath ? { cliPath } : {}),
          // When the app runs as a compiled Bun executable, SDK subprocesses may
          // use this binary as process.execPath. This makes that subprocess behave
          // like the Bun CLI (execute passed JS entrypoints) instead of re-running
          // this app's embedded entrypoint.
          env: {
            ...process.env,
            BUN_BE_BUN: "1",
          },
        });
        await client.start();
        return client;
      } catch (error) {
        // Reset promise so next call can retry
        copilotClientPromise = undefined;
        throw error;
      }
    })();
  }
  return copilotClientPromise;
}

// ============================================================================
// SDK Operations
// ============================================================================

/** Session ID prefix for sessions created by this web app */
export const SESSION_ID_PREFIX = "toy-box-";

const onPermissionRequest: PermissionHandler = () => ({ kind: "approved" });

export async function createSession(
  sessionId: string,
  model?: string,
  directory?: string,
): Promise<CopilotSession> {
  const client = await getCopilotClient();

  // Build system message with directory context if provided
  const systemMessage = directory
    ? {
        mode: "append" as const,
        content: `The user's working directory is: ${directory}. All file paths should be interpreted relative to this directory, and file operations should target this location.`,
      }
    : undefined;

  return client.createSession({
    sessionId,
    streaming: true,
    model,
    workingDirectory: directory,
    systemMessage,
    onPermissionRequest,
  });
}

export async function resumeSession(sessionId: string): Promise<CopilotSession> {
  const client = await getCopilotClient();
  return client.resumeSession(sessionId, {
    streaming: true,
    onPermissionRequest,
  });
}

/** Delete a session from SDK persistence */
export async function deleteSession(sessionId: string): Promise<void> {
  const client = await getCopilotClient();
  await client.deleteSession(sessionId);
}

/** List all sessions from the SDK (includes persisted sessions) */
export async function listAllSessions(): Promise<SessionMetadata[]> {
  const client = await getCopilotClient();
  const sessions = await client.listSessions();
  await backfillMissingContext(sessions);
  return sessions;
}

/**
 * Backfill context for sessions where the SDK returned context: undefined.
 *
 * The SDK CLI writes git info (gitRoot, repository, branch) into the
 * session.start event but may not persist it to workspace.yaml,
 * causing listSessions() to return context: undefined. We read the first
 * line of each session's events.jsonl to recover the context.
 */
/**
 * Read context from a session's session.start event in events.jsonl.
 *
 * The SDK CLI writes git info (gitRoot, repository, branch) into the
 * session.start event but may not persist it to workspace.yaml,
 * causing listSessions() to return context: undefined.
 */
export async function readSessionContextFromEvents(
  sessionId: string,
): Promise<SessionContext | undefined> {
  try {
    const sessionsDir = resolve(homedir(), ".copilot", "session-state");
    const eventsPath = join(sessionsDir, sessionId, "events.jsonl");
    const raw = await readFile(eventsPath, "utf-8");
    const firstNewline = raw.indexOf("\n");
    const firstLine = firstNewline === -1 ? raw : raw.slice(0, firstNewline);
    if (!firstLine) return undefined;

    const event = JSON.parse(firstLine);
    if (event?.type === "session.start" && event?.data?.context) {
      const ctx = event.data.context;
      return {
        cwd: ctx.cwd,
        gitRoot: ctx.gitRoot,
        repository: ctx.repository,
        branch: ctx.branch,
      };
    }
  } catch {
    // Session files may not exist or be unreadable — skip silently
  }
  return undefined;
}

async function backfillMissingContext(sessions: SessionMetadata[]): Promise<void> {
  await Promise.all(
    sessions.map(async (session) => {
      if (session.context) return;
      session.context = await readSessionContextFromEvents(session.sessionId);
    }),
  );
}

/** List available models */
export async function listAvailableModels() {
  const client = await getCopilotClient();
  return client.listModels();
}
