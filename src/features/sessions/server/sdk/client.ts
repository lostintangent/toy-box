// Server-only Copilot SDK adapter. Public session operations lead; process
// startup, system-message construction, and context normalization follow.

import { approveAll, CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import type { CopilotSession, SessionContext, SessionMetadata, Tool } from "@github/copilot-sdk";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SessionSkill, SessionType } from "@sessions/model";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";
import { toSdkSessionModelOptions } from "@sessions/model/modelConfiguration";
import { SESSION_ID_PREFIX, SESSION_STATE_PATH } from "@sessions/model/constants";
import { SDK_AGENT_NOTIFICATION_INSTRUCTIONS } from "@sessions/server/sdk/agentNotificationCodec";
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
  },
): Promise<CopilotSession> {
  const skillDirectories = getSessionSkillDirectories(options.sessionType);
  const client = await startCopilotClient();

  return client.createSession({
    sessionId,
    streaming: true,
    requestCanvasRenderer: true,
    ...toSdkSessionModelOptions(options.model),
    workingDirectory: options.directory,
    enableConfigDiscovery: true,
    enableSkills: true,
    skillDirectories,
    systemMessage: buildSessionSystemMessage(sessionId, options),
    onPermissionRequest: approveAll,
    tools: options.tools,
  });
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
  options: { directory: string; sessionType: SessionType; tools?: Tool<any>[] },
): Promise<CopilotSession> {
  const skillDirectories = getSessionSkillDirectories(options.sessionType);
  const client = await startCopilotClient();
  return client.resumeSession(sessionId, {
    streaming: true,
    requestCanvasRenderer: true,
    workingDirectory: options.directory,
    enableConfigDiscovery: true,
    enableSkills: true,
    skillDirectories,
    systemMessage: buildSessionSystemMessage(sessionId, options),
    onPermissionRequest: approveAll,
    tools: options.tools,
  });
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
  const client = await startCopilotClient();
  const metadata = await client.getSessionMetadata(sessionId);
  const context = metadata?.context
    ? normalizeSessionContext(metadata.context)
    : await readSessionContext(sessionId);
  return context?.workingDirectory;
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

export function buildSessionSystemMessage(
  sessionId: string,
  options: {
    directory?: string;
    model?: ModelConfiguration;
    sessionType: SessionType;
    artifactPath?: string;
  },
) {
  const { artifactPath, directory, model, sessionType } = options;

  const parts: string[] = [];

  if (model) {
    parts.push(`This session was created with model configuration: ${JSON.stringify(model)}.`);
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
    `This session's state folder is: ${sessionStateDirectory}. This session's files folder is: ${sessionFilesDirectory}. Unless otherwise specified, when the user asks you to create an artifact, spec, plan, or session document, write it under the files folder. Artifact paths in Toy Box notifications are relative to this files folder. If this session does not have a working directory, use this files folder as the default location for new files.`,
  );

  if (sessionType === "standard") {
    parts.push(
      "Keep this session's title recognizable. Before completing the first turn, you MUST call `update_session_title` once with a concise 2-6 word title after understanding the user's initial intent. On later turns, call it again before responding only when the session's focus has changed materially, not for ordinary follow-ups or refinements. Do not mention routine title updates to the user.",
    );
  }

  if (sessionType === "inbox") {
    parts.push(
      `This session is running a background task managed by the Toy Box inbox, and its session ID is also its inbox entry ID. Before finishing its initial task, ensure useful work leaves a durable, user-visible outcome. If the task naturally created or changed something durable outside this session—such as files in the user's working directory or an automation—do not duplicate it with an inbox result.`,
      "If the initial task did not otherwise produce a durable outcome, you MUST call `send_to_inbox` exactly once. Keep its message to 1 sentence that concisely summarizes the useful result (e.g. either an answer to a question or a recognizable title for a generated artifact). If satisfying the user's request requires a longer result—such as a research report, a spec/plan, or other generated content that is more than a simple answer—include an `artifact` with its filename and complete contents in that same call. Only include an artifact when the request requires it: if the complete useful result fits in the message, omit it. Never use the inbox for routine progress updates. After the initial inbox result has been delivered, respond to follow-up turns normally and do not call `send_to_inbox` again.",
    );
  }

  if (artifactPath) {
    parts.push(
      `The draft began with the artifact \`${artifactPath}\`, which is the center of the user's initial discussion. Read and update that file when the user's request refers to the document, diagram, or artifact without naming a path.`,
    );
  }

  if (sessionType === "automation") {
    parts.push(
      "This is an automation session: its session ID is also its automation ID. Use the automation tools when the task requires inspecting or changing that automation.",
      "Treat user edits to this run's artifacts as feedback on the automation prompt. When the intent is clear, update the automation accordingly.",
    );
  }

  if (sessionType === "hyper") {
    parts.push(
      "This is Toy Box's Hyper session, a global floating session window for observing other sessions, managing the Toy Box environment, answering questions, and performing tasks.",
    );
  }

  parts.push(
    'Toy Box renders files ending in `.svg` as rich, directly editable drawing artifacts. When creating a whiteboard, drawing, or spatial diagram, write standard static SVG with an `xmlns`, a meaningful `viewBox`, and ordinary SVG elements such as `<g>`, `<path>`, `<rect>`, `<ellipse>`, `<line>`, `<text>`, and `<image>`; gradients, filters, masks, patterns, markers, and transforms are supported. Give logical objects unique, descriptive IDs and wrap multi-part objects in `<g id="...">` so Toy Box can select, move, resize, and rotate them as one unit. Keep the file self-contained when practical. The editor supplies its own theme-derived background and dot grid, so do not add a background unless it is meaningful document content. Editable SVG artifacts must not contain doctypes, scripts, `<foreignObject>`, event-handler attributes, imported or executable CSS, or unsafe resource protocols.',
    `If needed, you can discover other sessions by grepping the files at ~/${SESSION_STATE_PATH}/${SESSION_ID_PREFIX}*/events.jsonl — each parent directory name is a session ID and the events.jsonl contains the full session history including user messages. Do NOT use a database to look up sessions; always grep these files directly.`,
    SDK_AGENT_NOTIFICATION_INSTRUCTIONS,
  );

  return {
    mode: "append" as const,
    content: parts.join("\n\n"),
  };
}

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

/** Use the installed native CLI in Bun development and the global executable
 *  in a compiled production binary. */
function resolveCopilotCliPath(): string {
  if (import.meta.env.DEV) {
    return Bun.resolveSync(`@github/copilot-${process.platform}-${process.arch}`, process.cwd());
  }

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
