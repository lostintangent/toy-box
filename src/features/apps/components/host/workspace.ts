import { replaceEqualDeep } from "@tanstack/react-query";
import type { SessionsState } from "@sessions/model";
import { selectNonWorkerSessions } from "@sessions/queries";
import type { WorkspaceState } from "@workspace/model/state/reducer";
import type { WorkspacePane } from "@workspace/model/panes";
import type { ModelInfo } from "@sessions/model";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";
import type { AppSession, AppWorkspace } from "@apps/sdk";

type AppWorkspaceSource = {
  workspace: WorkspaceState;
  sessions: SessionsState;
  models: readonly ModelInfo[];
  defaultModel: ModelConfiguration | null;
  appId: string;
  openPanes: readonly WorkspacePane[];
};

export function projectAppWorkspace(
  { workspace, sessions, models, defaultModel, appId, openPanes }: AppWorkspaceSource,
  previous?: AppWorkspace,
): AppWorkspace {
  const definitions = new Map(
    workspace.appDefinitions.map((definition) => [definition.id, definition]),
  );
  const automationIds = new Set(workspace.automations.map((automation) => automation.id));
  const hyperSessionIds = new Set(workspace.hyperSessionIds);
  const inboxIds = new Set(workspace.inboxEntries.map((entry) => entry.id));
  const sessionKind = (sessionId: string): AppSession["kind"] =>
    automationIds.has(sessionId)
      ? "automation"
      : hyperSessionIds.has(sessionId)
        ? "hyper"
        : "standard";
  const childrenByParent = new Map<string, SessionsState["sessions"]>();
  for (const session of sessions.sessions) {
    const parentSessionId = sessions.workerSessionParents[session.sessionId];
    if (!parentSessionId) continue;
    const children = childrenByParent.get(parentSessionId) ?? [];
    children.push(session);
    childrenByParent.set(parentSessionId, children);
  }

  function projectSession(session: SessionsState["sessions"][number]): AppSession {
    return {
      id: session.sessionId,
      title: session.summary?.trim() || "Untitled session",
      status: workspace.sessionStates[session.sessionId]?.status ?? "idle",
      kind: sessionKind(session.sessionId),
      directory: session.context?.workingDirectory,
      isRemote: session.isRemote ?? false,
      worktree: sessions.worktrees[session.sessionId],
      children: (childrenByParent.get(session.sessionId) ?? []).map(projectSession),
    };
  }

  const next: AppWorkspace = {
    sessions: selectNonWorkerSessions(sessions)
      .filter(({ sessionId }) => !inboxIds.has(sessionId))
      .map(projectSession),
    apps: workspace.apps.map(({ id, definitionId, title, revision, updatedAt }) => ({
      id,
      definitionId,
      title,
      revision,
      updatedAt,
      accepts: definitions.get(definitionId)?.accepts ?? [],
    })),
    shares: workspace.appShares.filter((share) => share.targetAppId === appId),
    models: models.map(({ id, name, supportedReasoningEfforts, defaultReasoningEffort }) => ({
      id,
      name,
      supportedReasoningEfforts,
      defaultReasoningEffort,
    })),
    defaultModel,
    openSessionIds: openPanes
      .filter((pane) => pane.kind === "session")
      .map((pane) => pane.sessionId),
    openFiles: openPanes.filter((pane) => pane.kind === "editor").map((pane) => pane.file),
    workers: workspace.workers
      .filter((worker) => worker.type === "app" && worker.appId === appId)
      .map(({ sessionId, name, metadata }) => ({ sessionId, name, metadata })),
  };

  return previous ? replaceEqualDeep(previous, next) : next;
}
