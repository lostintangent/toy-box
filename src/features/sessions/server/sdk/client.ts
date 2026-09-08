// Server-only Copilot SDK adapter. Public session operations lead; process
// startup, system-message construction, and context normalization follow.

import { approveAll, CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import type { CopilotSession, SessionContext, SessionMetadata, Tool } from "@github/copilot-sdk";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SessionSkill, SessionType } from "@sessions/model";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";
import { toSdkSessionModelOptions, toSdkSetModelOptions } from "@sessions/model/modelConfiguration";
import { SESSION_ID_PREFIX, SESSION_STATE_PATH } from "@sessions/model/constants";
import { toSessionSkills } from "@sessions/server/sdk/skills";
import { getSessionSkillDirectories } from "@sessions/server/sdk/bundledSkills";
import { sharedMap } from "@/shared/server/processState";

// ── Public API ────────────────────────────────────────────────────────

export async function createSession(
  sessionId: string,
  options: {
    model?: ModelConfiguration;
    directory?: string;
    tools?: Tool<any>[];
    sessionType: SessionType;
    artifactPath?: string;
    additionalInstructions?: string;
    disableMemory?: boolean;
  },
): Promise<CopilotSession> {
  const skillDirectories = getSessionSkillDirectories(options.sessionType);
  const client = await startCopilotClient();

  const session = await client.createSession({
    sessionId,
    streaming: true,
    requestCanvasRenderer: true,
    ...toSdkSessionModelOptions(options.model),
    workingDirectory: options.directory,
    enableConfigDiscovery: true,
    enableSkills: true,
    skillDirectories,
    systemMessage: buildSessionSystemPrompt(sessionId, options),
    onPermissionRequest: approveAll,
    tools: options.tools,
    ...(options.disableMemory ? { memory: { enabled: false } } : {}),
  });
  await registerUserQuestionInterest(session, options.sessionType);
  return session;
}

/** Persist a promoted draft's location and return the SDK-resolved git context. */
export async function setSessionWorkingDirectory(
  session: CopilotSession,
  workingDirectory: string,
): Promise<SessionContext> {
  await session.rpc.metadata.setWorkingDirectory({ workingDirectory });
  const snapshot = await session.rpc.metadata.snapshot();
  if (!snapshot.workspace) {
    throw new Error("SDK session has no workspace after setting its working directory.");
  }

  return {
    workingDirectory: snapshot.workingDirectory,
    ...(snapshot.workspace.git_root ? { gitRoot: snapshot.workspace.git_root } : {}),
    ...(snapshot.workspace.repository ? { repository: snapshot.workspace.repository } : {}),
    ...(snapshot.workspace.branch ? { branch: snapshot.workspace.branch } : {}),
  };
}

export async function createDraftSession(
  sessionId: string,
  artifact?: { path: string; content: string },
): Promise<void> {
  const client = await startCopilotClient();

  const session = await client.createSession({
    sessionId,
    workingDirectory: homedir(),
  });

  if (artifact) await session.rpc.workspaces.createFile(artifact);

  await session.disconnect();
}

export async function resumeSession(
  sessionId: string,
  options: {
    model?: ModelConfiguration;
    directory: string;
    sessionType: SessionType;
    tools?: Tool<any>[];
    additionalInstructions?: string;
    disableMemory?: boolean;
  },
): Promise<CopilotSession> {
  const skillDirectories = getSessionSkillDirectories(options.sessionType);
  const client = await startCopilotClient();
  const session = await client.resumeSession(sessionId, {
    streaming: true,
    requestCanvasRenderer: true,
    ...toSdkSessionModelOptions(options.model),
    workingDirectory: options.directory,
    enableConfigDiscovery: true,
    enableSkills: true,
    skillDirectories,
    systemMessage: buildSessionSystemPrompt(sessionId, options),
    onPermissionRequest: approveAll,
    tools: options.tools,
    ...(options.disableMemory ? { memory: { enabled: false } } : {}),
  });
  // The current SDK restores the persisted model on resume even when the
  // resume request carries a model override. Apply the effective host choice
  // through the SDK's explicit switching contract before the next message.
  if (options.model) {
    await session.setModel(options.model.name, toSdkSetModelOptions(options.model));
  }
  await registerUserQuestionInterest(session, options.sessionType);
  return session;
}

async function registerUserQuestionInterest(
  session: CopilotSession,
  sessionType: SessionType,
): Promise<void> {
  if (sessionType === "standard" || sessionType === "hyper") {
    await session.rpc.eventLog.registerInterest({
      eventType: "user_input.requested",
    });
  }
}

/** Delete a session from SDK persistence */
export async function deleteSession(sessionId: string): Promise<void> {
  const client = await startCopilotClient();
  await client.deleteSession(sessionId);
}

/** List persisted SDK sessions with normalized workspace context. */
export async function listSessions(): Promise<SessionMetadata[]> {
  const client = await startCopilotClient();
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
    const raw = await Bun.file(eventsPath).text();
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
  return (await getSessionContext(sessionId))?.workingDirectory;
}

/** Read persisted Git context, falling back to the SDK workspace metadata
 * available before a new Session has flushed its first event. */
export async function getSessionContext(sessionId: string): Promise<SessionContext | undefined> {
  const persisted = await readSessionContext(sessionId);
  if (persisted) return persisted;
  const metadata = await (await startCopilotClient()).getSessionMetadata(sessionId);
  return metadata?.context ? normalizeSessionContext(metadata.context) : undefined;
}

export async function listModels() {
  const client = await startCopilotClient();
  return client.listModels();
}

/** Discover user-invocable skills for a working directory, or host-level skills without one. */
export async function listSkills(
  cwd?: string,
  sessionType: SessionType = "standard",
): Promise<SessionSkill[]> {
  const skillDirectories = getSessionSkillDirectories(sessionType);
  const client = await startCopilotClient();
  const result = await client.rpc.skills.discover({
    ...(cwd ? { projectPaths: [cwd] } : {}),
    skillDirectories,
  });
  return toSessionSkills(result.skills);
}

// ── Session configuration ─────────────────────────────────────────────

export function buildSessionSystemPrompt(
  sessionId: string,
  options: {
    directory?: string;
    model?: ModelConfiguration;
    artifactPath?: string;
    additionalInstructions?: string;
  },
) {
  const { additionalInstructions, artifactPath, directory, model } = options;

  const parts: string[] = [];

  if (model) {
    parts.push(`This session is using model configuration: ${JSON.stringify(model)}.`);
  }

  if (directory) {
    parts.push(
      `The user's current working directory is: ${directory}. Unless otherwise specified, all mentioned file paths should be interpreted relative to this directory, and file operations should target this location.`,
    );
  }

  const sessionStateDirectory = `~/${SESSION_STATE_PATH}/${sessionId}`;
  const sessionFilesDirectory = `${sessionStateDirectory}/files`;
  parts.push(
    `This session's ID is: ${sessionId}.`,
    `This session's state folder is: ${sessionStateDirectory}. This session's files folder is: ${sessionFilesDirectory}. Unless otherwise specified, when the user asks you to create an artifact, spec, plan, or session document, write it under the files folder. If this session does not have a working directory, use this files folder as the default location for new files.`,
  );

  if (artifactPath) {
    parts.push(
      `The draft began with the artifact \`${artifactPath}\`, which is the center of the user's initial discussion. Read and update that file when the user's request refers to the document, diagram, or artifact without naming a path.`,
    );
  }

  if (additionalInstructions) parts.push(additionalInstructions);

  parts.push(
    'Toy Box renders files ending in `.svg` as rich, directly editable drawing artifacts. When creating a whiteboard, drawing, or spatial diagram, write standard static SVG with an `xmlns`, a meaningful `viewBox`, and ordinary SVG elements such as `<g>`, `<path>`, `<rect>`, `<ellipse>`, `<line>`, `<text>`, and `<image>`; gradients, filters, masks, patterns, markers, and transforms are supported. Give logical objects unique, descriptive IDs and wrap multi-part objects in `<g id="...">` so Toy Box can select, move, resize, and rotate them as one unit. Keep the file self-contained when practical. The editor supplies its own theme-derived background and dot grid, so do not add a background unless it is meaningful document content. Editable SVG artifacts must not contain doctypes, scripts, `<foreignObject>`, event-handler attributes, imported or executable CSS, or unsafe resource protocols.',
  );

  return {
    mode: "append" as const,
    content: parts.join("\n\n"),
  };
}

export const SESSION_HISTORY_DISCOVERY_INSTRUCTIONS = `If needed, you can discover other sessions by grepping the files at ~/${SESSION_STATE_PATH}/${SESSION_ID_PREFIX}*/events.jsonl — each parent directory name is a session ID and the events.jsonl contains the full session history including user messages. Do NOT use a database to look up sessions; always grep these files directly.`;

// ── Client process ────────────────────────────────────────────────────

const copilotClients = sharedMap<Promise<CopilotClient>>("copilot-clients");

/** Start or reuse the one Copilot process shared by every server operation. */
export function startCopilotClient(): Promise<CopilotClient> {
  const existing = copilotClients.get("shared");
  if (existing) return existing;

  const promise = (async () => {
    const client = new CopilotClient({
      connection: RuntimeConnection.forStdio({ path: resolveCopilotCliPath() }),
      // Make a compiled Bun executable behave like the Bun CLI when the SDK
      // uses process.execPath for child JavaScript entrypoints.
      env: {
        ...process.env,
        BUN_BE_BUN: "1",
      },
    });
    await client.start();
    return client;
  })();
  copilotClients.set("shared", promise);
  void promise.catch(() => {
    if (copilotClients.get("shared") === promise) copilotClients.delete("shared");
  });
  return promise;
}

/** Resolve the user's installed Copilot CLI. */
function resolveCopilotCliPath(): string {
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
