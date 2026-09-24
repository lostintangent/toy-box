import { deleteSession, getSessionInfo, listSessions } from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "node:os";
import type { SessionProvider } from "@providers/server/provider";
import { ClaudeConnection } from "./connection";
import { closeClaudeQuery, startClaudeQuery, stopClaude } from "./client";
import { readClaudeHistory } from "./history";
import { createClaudeProjector } from "./projector";
import { toModelInfo } from "./models";

export const claudeProvider: SessionProvider = {
  id: "claude",
  name: "Claude Agent",
  async listModels() {
    const native = startClaudeQuery({ persistSession: false, cwd: homedir() });
    try {
      return (await native.supportedModels())
        .filter((model) => model.value !== "default")
        .map(toModelInfo);
    } finally {
      await closeClaudeQuery(native);
    }
  },
  async listSkills(directory, skillDirectories) {
    const native = startClaudeQuery({
      persistSession: false,
      cwd: directory ?? homedir(),
      skills: "all",
      plugins: skillDirectories.map((path) => ({ type: "local", path })),
    });
    try {
      return (await native.reloadSkills()).skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        type: "global" as const,
      }));
    } finally {
      await closeClaudeQuery(native);
    }
  },
  async listSessions() {
    return (await listSessions()).map((session) => ({
      id: session.sessionId,
      title: session.summary,
      createdAt: new Date(session.createdAt ?? session.lastModified),
      updatedAt: new Date(session.lastModified),
      context: {
        directory: session.cwd === homedir() ? undefined : session.cwd,
        branch: session.gitBranch === "HEAD" ? undefined : session.gitBranch,
      },
    }));
  },
  async readHistory({ id, provider }) {
    const nativeId = provider?.sessionId ?? id;
    return (await readClaudeHistory(nativeId)).flatMap(createClaudeProjector(id));
  },
  create: (sessionId, configuration) => ClaudeConnection.open({ id: sessionId }, configuration),
  resume: (session, configuration) => ClaudeConnection.open(session, configuration, true),
  async readDirectory(nativeId) {
    return (await getSessionInfo(nativeId))?.cwd;
  },
  async isHistoryCurrent(nativeId, capturedAt) {
    const info = await getSessionInfo(nativeId);
    return info !== undefined && info.lastModified < capturedAt;
  },
  delete: deleteSession,
  stop: stopClaude,
};
