// Server-only Copilot SDK adapter. Public session operations lead; process
// startup, system-message construction, and context normalization follow.

import { approveAll, CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import type { CopilotSession, SessionContext, SessionMetadata, Tool } from "@github/copilot-sdk";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ModelConfiguration, SessionType } from "@/types";
import { toSdkSessionModelOptions } from "@/lib/modelConfiguration";
import { SESSION_STATE_PATH } from "@/lib/paths";
import { SESSION_ID_PREFIX } from "@/lib/session/constants";
import { SDK_AGENT_NOTIFICATION_INSTRUCTIONS } from "@/functions/sdk/agentNotificationCodec";

// ── Public API ────────────────────────────────────────────────────────

export async function createSession(
  sessionId: string,
  options: {
    model?: ModelConfiguration;
    directory?: string;
    tools?: Tool<any>[];
    sessionType: SessionType;
  },
): Promise<CopilotSession> {
  const client = await getCopilotClient();

  return client.createSession({
    sessionId,
    streaming: true,
    requestCanvasRenderer: true,
    ...toSdkSessionModelOptions(options.model),
    workingDirectory: options.directory,
    systemMessage: buildSessionSystemMessage(sessionId, options),
    onPermissionRequest: approveAll,
    tools: options.tools,
  });
}

export async function resumeSession(
  sessionId: string,
  options: { directory: string; sessionType: SessionType; tools?: Tool<any>[] },
): Promise<CopilotSession> {
  const client = await getCopilotClient();
  return client.resumeSession(sessionId, {
    streaming: true,
    requestCanvasRenderer: true,
    workingDirectory: options.directory,
    systemMessage: buildSessionSystemMessage(sessionId, options),
    onPermissionRequest: approveAll,
    tools: options.tools,
  });
}

/** Delete a session from SDK persistence */
export async function deleteSession(sessionId: string): Promise<void> {
  const client = await getCopilotClient();
  await client.deleteSession(sessionId);
}

/** List persisted SDK sessions with normalized workspace context. */
export async function listSessions(): Promise<SessionMetadata[]> {
  const client = await getCopilotClient();
  const sessions = await client.listSessions();
  await Promise.all(
    sessions.map(async (session) => {
      session.context = session.context
        ? normalizeSessionContext(session.context)
        : await readSessionContext(session.sessionId);
    }),
  );
  return sessions;
}

/**
 * Recover normalized workspace context from a session's persisted start event.
 *
 * The SDK CLI writes git info (gitRoot, repository, branch) into the
 * session.start event but may not persist it to workspace.yaml,
 * causing listSessions() to return context: undefined.
 */
export async function readSessionContext(sessionId: string): Promise<SessionContext | undefined> {
  try {
    const eventsPath = join(homedir(), SESSION_STATE_PATH, sessionId, "events.jsonl");
    const raw = await readFile(eventsPath, "utf-8");
    const firstNewline = raw.indexOf("\n");
    const firstLine = firstNewline === -1 ? raw : raw.slice(0, firstNewline);
    if (!firstLine) return undefined;

    const event = JSON.parse(firstLine);
    if (event?.type === "session.start" && event?.data?.context) {
      const ctx = event.data.context;
      return normalizeSessionContext({
        workingDirectory: ctx.workingDirectory ?? ctx.cwd,
        gitRoot: ctx.gitRoot,
        repository: ctx.repository,
        branch: ctx.branch,
      });
    }
  } catch {
    // Session files may not exist or be unreadable — skip silently
  }
  return undefined;
}

/**
 * Recover a persisted session's meaningful working directory from SDK metadata,
 * falling back to its start event when metadata is incomplete. Home-directory
 * fallback sessions remain application-level user scope and return undefined.
 */
export async function getSessionDirectory(sessionId: string): Promise<string | undefined> {
  const client = await getCopilotClient();
  const metadata = await client.getSessionMetadata(sessionId);
  const context = metadata?.context
    ? normalizeSessionContext(metadata.context)
    : await readSessionContext(sessionId);
  return context?.workingDirectory;
}

export async function listModels() {
  const client = await getCopilotClient();
  return client.listModels();
}

// ── Session configuration ─────────────────────────────────────────────

export function buildSessionSystemMessage(
  sessionId: string,
  options: { directory?: string; sessionType: SessionType },
) {
  const { directory, sessionType } = options;

  const parts: string[] = [];

  if (directory) {
    parts.push(
      `The user's current working directory is: ${directory}. Unless otherwise specified, all mentioned file paths should be interpreted relative to this directory, and file operations should target this location.`,
    );
  }

  if (sessionType === "inbox") {
    parts.push(
      `This session's ID is: ${sessionId}. It is running a background task managed by the Toy Box inbox, and its session ID is also its inbox entry ID. Before finishing its initial task, ensure useful work leaves a durable, user-visible outcome. If the task naturally created or changed something durable outside this session—such as files in the user's working directory or an automation—do not duplicate it with an inbox result.`,
      "If the initial task did not otherwise produce a durable outcome, you MUST call `send_to_inbox` exactly once. Keep its message to 1 sentence that concisely summarizes the useful result (e.g. either an answer to a question or a recognizable title for a generated artifact). If satisfying the user's request requires a longer result—such as a research report, a spec/plan, or other generated content that is more than a simple answer—include an `artifact` with its filename and complete contents in that same call. Only include an artifact when the request requires it: if the complete useful result fits in the message, omit it. Never use the inbox for routine progress updates. After the initial inbox result has been delivered, respond to follow-up turns normally and do not call `send_to_inbox` again.",
      `When \`send_to_inbox\` includes an artifact, Toy Box stores it at ~/.toy-box/inbox/${sessionId}/<filename>. Artifact paths in Toy Box notifications are relative to this inbox folder. Use that file for any later follow-up work on the artifact.`,
    );
  } else {
    const sessionStateDirectory = `~/${SESSION_STATE_PATH}/${sessionId}`;
    const sessionFilesDirectory = `${sessionStateDirectory}/files`;
    parts.push(
      `This session's ID is: ${sessionId}.`,
      `This session's state folder is: ${sessionStateDirectory}. This session's files folder is: ${sessionFilesDirectory}. Unless otherwise specified, when the user asks you to create an artifact, spec, plan, or session document, write it under the files folder. Artifact paths in Toy Box notifications are relative to this files folder. If this session does not have a working directory, use this files folder as the default location for new files.`,
    );

    if (sessionType === "automation") {
      parts.push(
        "This is an automation session: its session ID is also its automation ID. Use the automation tools when the task requires inspecting or changing that automation.",
        "Treat user edits to this run's artifacts as feedback on the automation prompt. When the intent is clear, update the automation accordingly.",
      );
    }
  }

  parts.push(
    `If needed, you can discover other sessions by grepping the files at ~/${SESSION_STATE_PATH}/${SESSION_ID_PREFIX}*/events.jsonl — each parent directory name is a session ID and the events.jsonl contains the full session history including user messages. Do NOT use a database to look up sessions; always grep these files directly.`,
    SDK_AGENT_NOTIFICATION_INSTRUCTIONS,
  );

  return {
    mode: "append" as const,
    content: parts.join("\n\n"),
  };
}

// ── Client process ────────────────────────────────────────────────────

let copilotClientPromise: Promise<CopilotClient> | undefined;

function getCopilotClient(): Promise<CopilotClient> {
  if (!copilotClientPromise) {
    copilotClientPromise = (async () => {
      try {
        const cliPath = resolveCopilotCliPath();
        const client = new CopilotClient({
          // Compiled binaries cannot rely on the SDK's import.meta.resolve
          // lookup, so production passes the global CLI explicitly.
          ...(cliPath ? { connection: RuntimeConnection.forStdio({ path: cliPath }) } : {}),
          // Make a compiled Bun executable behave like the Bun CLI when the SDK
          // uses process.execPath for child JavaScript entrypoints.
          env: {
            ...process.env,
            BUN_BE_BUN: "1",
          },
        });
        await client.start();
        return client;
      } catch (error) {
        copilotClientPromise = undefined;
        throw error;
      }
    })();
  }
  return copilotClientPromise;
}

/** Use the SDK's bundled CLI in development and the global executable in a
 *  compiled production binary. */
function resolveCopilotCliPath(): string | undefined {
  if (import.meta.env.DEV) return;

  try {
    const copilotBin = Bun.which("copilot");
    if (copilotBin) {
      try {
        return realpathSync(copilotBin);
      } catch {
        return copilotBin;
      }
    }
  } catch {
    // PATH lookup failed; report the actionable installation error below.
  }

  throw new Error(
    "Could not find `copilot` on PATH. Install it globally with `npm i -g @github/copilot`.",
  );
}

// ── Context policy ────────────────────────────────────────────────────

/** Remove the SDK's implicit homedir fallback so list display, inheritance,
 *  and resumed-session tool scope all agree on whether a session has a
 *  meaningful workspace. */
function normalizeSessionContext(context: SessionContext): SessionContext | undefined {
  if (!context.workingDirectory) return undefined;
  if (context.workingDirectory === homedir() && !context.gitRoot && !context.repository) {
    return undefined;
  }
  return context;
}
