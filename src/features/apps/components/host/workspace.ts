import { replaceEqualDeep } from "@tanstack/react-query";
import type { AppList } from "@apps/model";
import type { SessionsState } from "@sessions/model";
import type { SessionsActivity } from "@sessions/model/activity";
import { selectNonWorkerSessions, selectSessionChildren } from "@sessions/queries";
import type { WorkspacePane } from "@workspace/model/panes";
import type { ModelConfiguration, ModelInfo } from "@providers/model";
import type { AppSession, AppWorkspace } from "@apps/sdk";
import type { Worker } from "@workers/model";

type AppWorkspaceSource = {
  activities: SessionsActivity;
  hyperSessionIds: readonly string[];
  workers: readonly Worker[];
  apps: AppList;
  sessions: SessionsState;
  models: readonly ModelInfo[];
  defaultModel: ModelConfiguration | null;
  appId?: string;
  openPanes: readonly WorkspacePane[];
};

export function projectAppWorkspace(
  {
    activities,
    hyperSessionIds,
    workers,
    apps,
    sessions,
    models,
    defaultModel,
    appId,
    openPanes,
  }: AppWorkspaceSource,
  previous?: AppWorkspace,
): AppWorkspace {
  const definitions = new Map(apps.definitions.map((definition) => [definition.id, definition]));
  const hyperIds = new Set(hyperSessionIds);
  const sessionKind = (sessionId: string): AppSession["kind"] =>
    sessions.ownership[sessionId]?.type === "automation"
      ? "automation"
      : hyperIds.has(sessionId)
        ? "hyper"
        : "standard";
  const childrenByParent = selectSessionChildren(sessions);

  function projectSession(session: SessionsState["sessions"][number]): AppSession {
    return {
      ...session,
      status: activities[session.id]?.status ?? "idle",
      kind: sessionKind(session.id),
      worktree: sessions.worktrees[session.id],
      children: (childrenByParent[session.id] ?? []).map(projectSession),
    };
  }

  const next: AppWorkspace = {
    sessions: selectNonWorkerSessions(sessions).map(projectSession),
    apps: apps.apps.map(({ id, definitionId, title, revision, updatedAt }) => ({
      id,
      definitionId,
      title,
      revision,
      updatedAt,
      accepts: definitions.get(definitionId)?.accepts ?? [],
    })),
    shares: appId ? apps.shares.filter((share) => share.targetAppId === appId) : [],
    models,
    defaultModel,
    openSessionIds: openPanes
      .filter((pane) => pane.kind === "session")
      .map((pane) => pane.sessionId),
    openFiles: openPanes.filter((pane) => pane.kind === "editor").map((pane) => pane.file),
    workers: appId
      ? workers
          .filter((worker) => worker.type === "app" && worker.appId === appId)
          .map(({ sessionId, name, metadata }) => ({ sessionId, name, metadata }))
      : [],
  };

  return previous ? replaceEqualDeep(previous, next) : next;
}
