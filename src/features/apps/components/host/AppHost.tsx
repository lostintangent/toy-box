import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import {
  Component,
  useEffect,
  useLayoutEffect,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import type { AppActions } from "@apps/sdk";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { useModels } from "@sessions/useModels";
import { createEmptySessionsState, sessionQueries } from "@sessions/queries";
import { paneSourceSessionId, type WorkspacePane } from "@workspace/model/panes";
import { AppHostProvider } from "./context";
import { bindAppActions, bindSavedAppActions } from "./actions";
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
  savedApp?: {
    id: string;
    state: AppStateStore;
    spawnWorker: AppActions["spawnWorker"];
    cancelWorker: AppActions["cancelWorker"];
  };
}) {
  const workspaceState = useWorkspaceSelector((state) => state);
  const { data: sessionsState = createEmptySessionsState() } = useQuery(sessionQueries.state());
  const { models, defaultModel } = useModels();
  const surface = useWorkspaceSurface();
  const linkedPanes = useSelector(
    surface.panePublications,
    (published) => published[publisherPaneId] ?? NO_LINKED_PANES,
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
    appId: savedApp?.id,
    openPanes: visibleLinkedPanes,
  };
  const [workspaceStore] = useState(() => new Store(projectAppWorkspace(workspaceSource)));
  const workspace = projectAppWorkspace(workspaceSource, workspaceStore.state);
  const actions = bindAppActions({
    publisherPaneId,
    beforeDeliverMessage: savedApp ? () => savedApp.state.flush() : undefined,
    surface,
  });
  const savedAppHost = savedApp
    ? {
        state: savedApp.state,
        actions: bindSavedAppActions({
          appId: savedApp.id,
          actions,
          flushState: () => savedApp.state.flush(),
          spawnWorker: savedApp.spawnWorker,
          cancelWorker: savedApp.cancelWorker,
        }),
      }
    : undefined;

  useLayoutEffect(() => {
    if (workspace !== workspaceStore.state) workspaceStore.setState(() => workspace);
  }, [workspace, workspaceStore]);
  useEffect(() => {
    if (retainedPanes.length !== linkedPanes.length) {
      surface.panePublications.actions.publishLinkedPanes(publisherPaneId, retainedPanes);
    }
  }, [linkedPanes.length, publisherPaneId, retainedPanes, surface.panePublications]);
  const appState = savedApp?.state;
  useEffect(
    () => () => {
      if (appState) {
        void appState.flush().catch((error) => console.error("Unable to flush app state:", error));
      }
      surface.panePublications.actions.clearLinkedPanes(publisherPaneId);
    },
    [appState, publisherPaneId, surface.panePublications],
  );

  return (
    <div data-toybox-app={scopeId} className="h-full min-h-0">
      {css && <style>{css}</style>}
      <AppHostProvider workspace={workspaceStore} actions={actions} savedApp={savedAppHost}>
        <AppComponent />
      </AppHostProvider>
    </div>
  );
}

export class AppErrorBoundary extends Component<
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
        <AppMessage
          title={`${this.props.title} crashed`}
          detail={appErrorMessage(this.state.error)}
        >
          <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </AppMessage>
      );
    }
    return this.props.children;
  }
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
