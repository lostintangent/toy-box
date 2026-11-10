import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { CatchBoundary, ClientOnly } from "@tanstack/react-router";
import { useSelector } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { useEffect, useLayoutEffect, useState, type ComponentType, type ReactNode } from "react";
import { Button } from "@/shared/ui/button";
import { PaneMessage } from "@/shared/ui/pane-message";
import { appQueries } from "@apps/queries";
import type { OpenedFile } from "@apps/sdk";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { useModels } from "@providers/useModels";
import { sessionQueries } from "@sessions/queries";
import { useSessionsActivity } from "@sessions/useSessionActivity";
import { workerQueries } from "@workers/queries";
import type { WorkspacePane } from "@workspace/model/panes";
import { AppHostContext } from "./context";
import { bindAppActions } from "./actions";
import { projectAppWorkspace } from "./workspace";
import type { AppStateStore } from "./state";

const NO_LINKED_PANES: readonly WorkspacePane[] = [];

export type AppBundle = { Component: ComponentType; css: string; scopeId: string };
/** A query whose data is a compiled app; which source it compiles is the caller's concern. */
type AppBundleQuery = UseQueryOptions<AppBundle, Error, AppBundle, any>;

/** Loads an app bundle on the client and mounts it, with loading and failure states and crash recovery. */
export function AppMount({
  title,
  bundle,
  resetKey,
  children,
}: {
  title: string;
  bundle: AppBundleQuery;
  resetKey: number;
  children: (bundle: AppBundle) => ReactNode;
}) {
  return (
    <ClientOnly fallback={<AppLoading title={title} />}>
      <AppErrorBoundary title={title} resetKey={resetKey}>
        <LoadedApp title={title} bundle={bundle}>
          {children}
        </LoadedApp>
      </AppErrorBoundary>
    </ClientOnly>
  );
}

function LoadedApp({
  title,
  bundle,
  children,
}: {
  title: string;
  bundle: AppBundleQuery;
  children: (bundle: AppBundle) => ReactNode;
}) {
  const bundleQuery = useQuery(bundle);
  if (bundleQuery.isPending) return <AppLoading title={title} />;
  if (bundleQuery.isError) {
    return (
      <PaneMessage title={`Unable to load ${title}`} detail={appErrorMessage(bundleQuery.error)} />
    );
  }
  return children(bundleQuery.data);
}

function AppLoading({ title }: { title: string }) {
  return <PaneMessage title={`Loading ${title}`} detail="Loading app…" loading />;
}

/** Mounts compiled app code against the shared workspace and its optional saved app or opened file. */
export function AppHost({
  bundle: { Component: AppComponent, css, scopeId },
  publisherPaneId,
  savedApp,
  openedFile,
}: {
  bundle: AppBundle;
  publisherPaneId: string;
  savedApp?: AppStateStore;
  openedFile?: OpenedFile;
}) {
  const queryClient = useQueryClient();
  const activities = useSessionsActivity((activities) => activities);
  const hyperSessionId = useWorkspaceSelector((state) => state.settings.hyperSessionId);
  const { data: workers } = useSuspenseQuery(workerQueries.active);
  const { data: apps } = useSuspenseQuery(appQueries.list);
  const { data: sessionsState } = useSuspenseQuery(sessionQueries.state);
  const { models, defaultModel } = useModels();
  const surface = useWorkspaceSurface();
  const linkedPanes = useSelector(
    surface.panePublications,
    (published) => published[publisherPaneId] ?? NO_LINKED_PANES,
  );
  const activeSessionIds = new Set(sessionsState.sessions.map(({ id }) => id));
  const validLinkedPanes = linkedPanes.filter(
    ({ sessionId }) => sessionId === undefined || activeSessionIds.has(sessionId),
  );
  const visiblePaneIds = new Set(surface.panes.map(({ id }) => id));
  const visibleLinkedPanes = validLinkedPanes.filter(({ id }) => visiblePaneIds.has(id));
  const retainedPanes =
    surface.panes.length >= surface.capacity ? visibleLinkedPanes : validLinkedPanes;
  const workspaceSource = {
    activities,
    hyperSessionId,
    workers,
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
      <AppHostContext value={{ workspace: workspaceStore, actions, savedApp, openedFile }}>
        <AppComponent />
      </AppHostContext>
    </div>
  );
}

function AppErrorBoundary({
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
        <PaneMessage title={`${title} crashed`} detail={appErrorMessage(error)}>
          <Button size="sm" variant="outline" onClick={reset}>
            Try again
          </Button>
        </PaneMessage>
      )}
    >
      {children}
    </CatchBoundary>
  );
}

function appErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unknown error occurred.";
}
