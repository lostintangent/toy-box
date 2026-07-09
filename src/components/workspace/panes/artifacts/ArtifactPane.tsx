import { Component, Suspense, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CommentThread } from "documint";
import { Skeleton } from "@/components/ui/skeleton";
import { respondToArtifactComment } from "@/functions/artifacts";
import { useArtifact } from "@/hooks/artifacts/useArtifact";
import { useLinkedPaneActions } from "@/hooks/workspace/layout/useLinkedPanes";
import type { ArtifactWorkspacePane } from "@/lib/workspace/panes";
import { createArtifactBaseUri } from "@/lib/session/artifacts/html";
import { useArtifactKind, type ArtifactRendererProps, type ArtifactKind } from "./kinds";
import type { PaneProps } from "../types";
import { ArtifactActions } from "./actions";

type ArtifactPaneProps = PaneProps & {
  pane: ArtifactWorkspacePane;
};

/** Composes one session-owned artifact's file lifecycle, actions, and renderer. */
export function ArtifactPane({ pane, variant = "normal", actionsSlot }: ArtifactPaneProps) {
  const { sourceSessionId: sessionId, path, title, mode } = pane;
  const { setArtifactPaneMode } = useLinkedPaneActions();
  const kind = useArtifactKind(path);
  const artifact = useArtifact({ sessionId, path, mode });
  const baseUri =
    typeof window === "undefined"
      ? undefined
      : createArtifactBaseUri(sessionId, path, window.location.origin);
  const { error, isLoading, isSaving, isReady } = artifact;

  async function respondToComment(threadId: string, thread: CommentThread) {
    await artifact.flush({ notifyAgent: false });
    await respondToArtifactComment({ data: { sessionId, path, threadId, thread } });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {actionsSlot &&
        kind.editable &&
        createPortal(
          <ArtifactActions
            mode={mode}
            isSaving={isSaving}
            onModeChange={(nextMode) => setArtifactPaneMode(pane, nextMode)}
            variant={variant}
          />,
          actionsSlot,
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
            respondToComment={respondToComment}
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
