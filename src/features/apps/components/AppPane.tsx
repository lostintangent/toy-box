import { ClientOnly } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import {
  Component,
  useEffect,
  useLayoutEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import type { SessionsState } from "@sessions/model";
import { updateApp } from "@apps/server/functions";
import { appQueries } from "@apps/queries";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { useModels } from "@sessions/useModels";
import { createEmptySessionsState, sessionQueries } from "@sessions/queries";
import { workerMutations } from "@workers/mutations";
import type { Worker } from "@workers/model";
import { applyWorkspaceEvent } from "@workspace/queries";
import type { WorkspaceState } from "@workspace/model/state/reducer";
import type { AppDefinition, AppInstance } from "@apps/model";
import {
  paneSourceSessionId,
  type AppWorkspacePane,
  type WorkspacePane,
} from "@workspace/model/panes";
import type { ModelInfo } from "@sessions/model";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";
import type { PaneVariant } from "@workspace/components/panes/WorkspacePaneView";
import { PaneStatus } from "@workspace/components/panes/shell/PaneSlots";
import { WorkersMenu } from "@workers/components/WorkersMenu";
import { bindAppActions } from "./host/actions";
import { AppHostProvider } from "./host/context";
import { AppStateStore } from "./host/state";
import { projectAppWorkspace } from "./host/workspace";

const NO_LINKED_PANES: readonly WorkspacePane[] = [];

export function AppPane({ pane, variant }: { pane: AppWorkspacePane; variant: PaneVariant }) {
  const workspace = useWorkspaceSelector((state) => state);
  const { data: sessionsState = createEmptySessionsState() } = useQuery(sessionQueries.state());
  const { models, defaultModel } = useModels();
  const app = workspace.apps.find((candidate) => candidate.id === pane.appId);
  const definition = workspace.appDefinitions.find(
    (candidate) => candidate.id === app?.definitionId,
  );

  if (!app) {
    return (
      <AppPaneMessage
        title="App not found"
        detail="This saved app may have been deleted in another Toy Box window."
      />
    );
  }
  if (!definition) {
    return (
      <AppPaneMessage
        title="App definition unavailable"
        detail={`The installed TSX definition "${app.definitionId}" could not be loaded.`}
      />
    );
  }

  return (
    <ClientOnly
      fallback={<AppPaneMessage title="Loading app" detail="Getting everything ready…" loading />}
    >
      <AppErrorBoundary
        key={`${app.id}:${definition.revision}`}
        title={app.title}
        resetKey={app.revision}
      >
        <MountedApp
          pane={pane}
          app={app}
          definition={definition}
          workspaceState={workspace}
          sessionsState={sessionsState}
          models={models}
          defaultModel={defaultModel}
          variant={variant}
        />
      </AppErrorBoundary>
    </ClientOnly>
  );
}

function MountedApp({
  pane,
  app,
  definition,
  workspaceState,
  sessionsState,
  models,
  defaultModel,
  variant,
}: {
  pane: AppWorkspacePane;
  app: AppInstance;
  definition: AppDefinition;
  workspaceState: WorkspaceState;
  sessionsState: SessionsState;
  models: readonly ModelInfo[];
  defaultModel: ModelConfiguration | null;
  variant: PaneVariant;
}) {
  const queryClient = useQueryClient();
  const surface = useWorkspaceSurface();
  const linkedPanes = useSelector(
    surface.panePublications,
    (published) => published[pane.id] ?? NO_LINKED_PANES,
  );
  const activeSessionIds = new Set(sessionsState.sessions.map(({ sessionId }) => sessionId));
  const validLinkedPanes = linkedPanes.filter((candidate) => {
    const sessionId = paneSourceSessionId(candidate);
    return sessionId === undefined || activeSessionIds.has(sessionId);
  });
  const visiblePaneIds = new Set(surface.panes.map(({ id }) => id));
  const visibleLinkedPanes = validLinkedPanes.filter(({ id }) => visiblePaneIds.has(id));
  const retainedPanes =
    surface.panes.length >= surface.capacity ? visibleLinkedPanes : validLinkedPanes;
  const workspaceSource = {
    workspace: workspaceState,
    sessions: sessionsState,
    models,
    defaultModel,
    appId: app.id,
    openPanes: visibleLinkedPanes,
  };
  const [appState] = useState(
    () =>
      new AppStateStore(app, definition.state.schema, async (update) => {
        const result = await updateApp({
          data: { appId: pane.appId, ...update },
        });
        applyWorkspaceEvent(queryClient, { type: "app.upserted", app: result.app });
        return result;
      }),
  );
  const [workspaceStore] = useState(() => new Store(projectAppWorkspace(workspaceSource)));
  const workspace = projectAppWorkspace(workspaceSource, workspaceStore.state);
  const appWorkers = workspaceState.workers.filter(
    (worker): worker is Extract<Worker, { type: "app" }> =>
      worker.type === "app" && worker.appId === app.id,
  );
  const spawnWorker = useMutation(workerMutations.spawn);
  const cancelWorker = useMutation(workerMutations.cancel);
  const actions = bindAppActions({
    appId: app.id,
    publisherPaneId: pane.id,
    flushState: () => appState.flush(),
    spawnWorker: (input) => spawnWorker.mutateAsync({ ...input, type: "app", appId: app.id }),
    cancelWorker: (workerSessionId) =>
      cancelWorker.mutateAsync({ type: "app", appId: app.id, workerSessionId }),
    surface,
  });

  useLayoutEffect(() => appState.sync(app), [app, appState]);
  useLayoutEffect(() => {
    if (workspace !== workspaceStore.state) workspaceStore.setState(() => workspace);
  }, [workspace, workspaceStore]);
  useEffect(() => {
    if (retainedPanes.length !== linkedPanes.length) {
      surface.panePublications.actions.publishLinkedPanes(pane.id, retainedPanes);
    }
  }, [linkedPanes.length, pane.id, retainedPanes, surface.panePublications]);
  useEffect(
    () => () => {
      void appState.flush().catch((error) => console.error("Unable to flush app state:", error));
      surface.panePublications.actions.clearLinkedPanes(pane.id);
    },
    [appState, pane.id, surface.panePublications],
  );

  const bundleQuery = useQuery(appQueries.bundle(definition.id, definition.revision));

  if (bundleQuery.isPending) {
    return <AppPaneMessage title={`Loading ${app.title}`} detail="Loading app…" loading />;
  }
  if (bundleQuery.isError) {
    return (
      <AppPaneMessage
        title={`Unable to load ${app.title}`}
        detail={errorMessage(bundleQuery.error)}
      />
    );
  }

  const { Component: AppComponent, css } = bundleQuery.data;
  return (
    <div data-toybox-app={definition.id} className="h-full min-h-0">
      {appWorkers.length > 0 && (
        <PaneStatus>
          <WorkersMenu workers={appWorkers} variant={variant} />
        </PaneStatus>
      )}
      {css && <style>{css}</style>}
      <AppHostProvider appState={appState} workspace={workspaceStore} actions={actions}>
        <AppComponent />
      </AppHostProvider>
    </div>
  );
}

class AppErrorBoundary extends Component<
  { title: string; resetKey: number; children: ReactNode },
  { error: Error | null; resetKey: number }
> {
  state = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: Readonly<{ resetKey: number }>,
    state: Readonly<{ resetKey: number }>,
  ) {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App render failed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <AppPaneMessage
          title={`${this.props.title} crashed`}
          detail={errorMessage(this.state.error)}
        >
          <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </AppPaneMessage>
      );
    }
    return this.props.children;
  }
}

function AppPaneMessage({
  title,
  detail,
  loading = false,
  children,
}: {
  title: string;
  detail: string;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-center">
      <div className="flex max-w-md flex-col items-center gap-3">
        {loading ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <AlertTriangle className="size-5 text-destructive" />
        )}
        <div>
          <h2 className="font-medium">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unknown error occurred.";
}
