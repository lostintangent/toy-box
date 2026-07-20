import { Component, Suspense, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cancelArtifactWorker as requestArtifactWorkerCancellation,
  spawnArtifactWorker as requestArtifactWorker,
} from "@/functions/artifacts";
import { useArtifact } from "@/hooks/artifacts/useArtifact";
import { setArtifactPaneMode } from "@/hooks/workspace/layout/linkedPanes";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
import type { ArtifactWorkspacePane } from "@/lib/workspace/panes";
import { createArtifactBaseUri } from "@/lib/session/artifacts/html";
import {
  useArtifactKind,
  type ArtifactRendererProps,
  type ArtifactKind,
  type ArtifactWorkerRequest,
} from "./kinds";
import type { PaneProps } from "../types";
import { PaneActions, PaneStatus } from "../PaneSlots";
import { ArtifactActions } from "./actions";
import { ArtifactWorkersMenu } from "./actions/ArtifactWorkersMenu";

type ArtifactPaneProps = PaneProps & {
  pane: ArtifactWorkspacePane;
};

/** Composes one session-owned artifact's file lifecycle, actions, and renderer. */
export function ArtifactPane({ pane, variant = "normal" }: ArtifactPaneProps) {
  const { sourceSessionId: sessionId, path, title, mode } = pane;
  const kind = useArtifactKind(path);
  const artifact = useArtifact({ sessionId, path, mode });
  const pendingWorkers = useWorkspaceSelector((workspace) =>
    workspace.artifactWorkers.filter(
      (worker) => worker.sourceSessionId === sessionId && worker.path === path,
    ),
  );
  const baseUri =
    typeof window === "undefined"
      ? undefined
      : createArtifactBaseUri(sessionId, path, window.location.origin);
  const { error, isLoading, isSaving, isReady } = artifact;

  async function spawnWorker({ name, prompt, metadata }: ArtifactWorkerRequest) {
    await artifact.flush({ notifyAgent: false });
    return requestArtifactWorker({
      data: {
        sessionId,
        path,
        ...(name === undefined ? {} : { name }),
        prompt,
        ...(metadata === undefined ? {} : { metadata }),
      },
    });
  }

  async function cancelWorker(workerSessionId: string) {
    await requestArtifactWorkerCancellation({
      data: { sessionId, path, workerSessionId },
    });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {(kind.editable || isSaving) && (
        <PaneActions>
          <ArtifactActions
            editable={kind.editable}
            mode={mode}
            isSaving={isSaving}
            onModeChange={(nextMode) => setArtifactPaneMode(pane, nextMode)}
            variant={variant}
          />
        </PaneActions>
      )}
      {pendingWorkers.length > 0 && (
        <PaneStatus>
          <ArtifactWorkersMenu
            workers={pendingWorkers}
            onCancelWorker={cancelWorker}
            variant={variant}
          />
        </PaneStatus>
      )}
      {isReady && error && <ArtifactBanner>{error}</ArtifactBanner>}
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <ArtifactSkeleton />
        ) : isReady ? (
          <ArtifactContent
            kind={kind}
            sessionId={sessionId}
            path={path}
            title={title}
            mode={mode}
            baseUri={baseUri}
            definition={kind.definition}
            artifact={artifact}
            pendingWorkers={pendingWorkers}
            spawnWorker={spawnWorker}
          />
        ) : (
          <ArtifactMessage>{error ?? "Unable to load this artifact."}</ArtifactMessage>
        )}
      </div>
    </div>
  );
}

function ArtifactContent({ kind, ...props }: ArtifactRendererProps & { kind: ArtifactKind }) {
  const { Renderer } = kind;
  return (
    <ArtifactErrorBoundary fallback={<ArtifactMessage>Unable to load this view.</ArtifactMessage>}>
      <Suspense fallback={<ArtifactSkeleton />}>
        <Renderer {...props} />
      </Suspense>
    </ArtifactErrorBoundary>
  );
}

class ArtifactErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function ArtifactBanner({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-b bg-background px-3 py-2 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function ArtifactSkeleton() {
  return (
    <div className="space-y-3 p-6">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

function ArtifactMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
