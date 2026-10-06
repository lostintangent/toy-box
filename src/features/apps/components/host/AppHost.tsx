import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { CatchBoundary } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { useEffect, useLayoutEffect, useState, type ComponentType, type ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { appQueries } from "@apps/queries";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { useModels } from "@providers/useModels";
import { sessionQueries } from "@sessions/queries";
import { paneSourceSessionId, type WorkspacePane } from "@workspace/model/panes";
import { AppHostProvider } from "./context";
import { bindAppActions } from "./actions";
import { projectAppWorkspace } from "./workspace";
import type { AppStateStore } from "./state";

const NO_LINKED_PANES: readonly WorkspacePane[] = [];

/** Mounts compiled app code against the shared workspace and optional saved-instance capabilities. */
export function AppHost({
  scopeId,
  publisherPaneId,
  AppComponent,
  css,
  savedApp,
}: {
  scopeId: string;
  publisherPaneId: string;
  AppComponent: ComponentType;
  css: string;
  savedApp?: AppStateStore;
}) {
  const queryClient = useQueryClient();
  const workspaceState = useWorkspaceSelector((state) => ({
    sessionStates: state.sessionStates,
    hyperSessionIds: state.hyperSessionIds,
    workers: state.workers,
  }));
  const { data: apps } = useSuspenseQuery(appQueries.list());
  const { data: sessionsState } = useSuspenseQuery(sessionQueries.state());
  const { models, defaultModel } = useModels();
  const surface = useWorkspaceSurface();
  const linkedPanes = useSelector(
    surface.panePublications,
    (published) => published[publisherPaneId] ?? NO_LINKED_PANES,
  );
  const activeSessionIds = new Set(sessionsState.sessions.map(({ id }) => id));
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
    apps,
    sessions: sessionsState,
    models,
    defaultModel,
    appId: savedApp?.store.state.id,
    openPanes: visibleLinkedPanes,
  };
  const [workspaceStore] = useState(() => new Store(projectAppWorkspace(workspaceSource)));
  const workspace = projectAppWorkspace(workspaceSource, workspaceStore.state);
  const actions = bindAppActions({
    publisherPaneId,
    queryClient,
    beforeDeliverMessage: savedApp ? () => savedApp.flush() : undefined,
    surface,
  });

  useLayoutEffect(() => {
    if (workspace !== workspaceStore.state) workspaceStore.setState(() => workspace);
  }, [workspace, workspaceStore]);
  useEffect(() => {
    if (retainedPanes.length !== linkedPanes.length) {
      surface.panePublications.actions.publishLinkedPanes(publisherPaneId, retainedPanes);
    }
  }, [linkedPanes.length, publisherPaneId, retainedPanes, surface.panePublications]);
  useEffect(
    () => () => {
      if (savedApp) {
        void savedApp.flush().catch((error) => console.error("Unable to flush app state:", error));
      }
      surface.panePublications.actions.clearLinkedPanes(publisherPaneId);
    },
    [savedApp, publisherPaneId, surface.panePublications],
  );

  return (
    <div data-toybox-app={scopeId} className="h-full min-h-0">
      {css && <style>{css}</style>}
      <AppHostProvider workspace={workspaceStore} actions={actions} savedApp={savedApp}>
        <AppComponent />
      </AppHostProvider>
    </div>
  );
}

export function AppErrorBoundary({
  title,
  resetKey,
  children,
}: {
  title: string;
  resetKey: number;
  children: ReactNode;
}) {
  return (
    <CatchBoundary
      getResetKey={() => resetKey}
      onCatch={(error, info) => console.error("App render failed:", error, info)}
      errorComponent={({ error, reset }) => (
        <AppMessage title={`${title} crashed`} detail={appErrorMessage(error)}>
          <Button size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        </AppMessage>
      )}
    >
      {children}
    </CatchBoundary>
  );
}

export function AppMessage({
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

export function appErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unknown error occurred.";
}
