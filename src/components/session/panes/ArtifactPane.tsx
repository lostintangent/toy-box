import { Component, Suspense, useEffect, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useArtifact } from "@/hooks/artifacts/useArtifact";
import type { ArtifactGridPane, ArtifactPaneMode } from "@/hooks/session/sessionPanes";
import { MobilePaneHeader } from "./chrome/MobilePaneHeader";
import { ArtifactModeMenu } from "./chrome/ArtifactModeMenu";
import { ArtifactSavingIndicator } from "./chrome/ArtifactSavingIndicator";
import { ARTIFACT_KINDS, type ArtifactContentProps } from "./artifacts/kinds";

type ArtifactPaneProps = {
  pane: ArtifactGridPane;
  onBack?: () => void;
  onModeChange?: (pane: ArtifactGridPane, mode: ArtifactPaneMode) => void;
  onSavingChange?: (isSaving: boolean) => void;
};

/** The host-facing artifact pane. It owns the artifact lifecycle (load/save/watch) and
 *  the shared chrome — mobile back bar, saving + mode controls, and the loading / error
 *  states — then hands the ready artifact to the content view registered for its kind. */
export function ArtifactPane({ pane, onBack, onModeChange, onSavingChange }: ArtifactPaneProps) {
  const artifact = useArtifact({
    sessionId: pane.sourceSessionId,
    path: pane.path,
    mode: pane.mode,
    usesPreview: ARTIFACT_KINDS[pane.kind].usesPreview,
  });
  const { error, isLoading, isSaving, isReady } = artifact;

  // Mirror the saving state up so the desktop grid controls can show it too.
  useEffect(() => {
    onSavingChange?.(isSaving);
  }, [isSaving, onSavingChange]);

  const mobileActions =
    isSaving || onModeChange ? (
      <>
        <ArtifactSavingIndicator isSaving={isSaving} />
        {onModeChange && (
          <ArtifactModeMenu mode={pane.mode} onModeChange={(mode) => onModeChange(pane, mode)} />
        )}
      </>
    ) : undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <MobilePaneHeader onBack={onBack} trailing={mobileActions} />
      {/* A non-fatal error (e.g. a failed save or watch) shown above still-readable content. */}
      {isReady && error && <ArtifactBanner>{error}</ArtifactBanner>}
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <ArtifactSkeleton />
        ) : isReady ? (
          <ArtifactContent pane={pane} artifact={artifact} />
        ) : (
          <ArtifactMessage>{error ?? "Unable to load this artifact."}</ArtifactMessage>
        )}
      </div>
    </div>
  );
}

function ArtifactContent({ pane, artifact }: ArtifactContentProps) {
  const { Component: Content } = ARTIFACT_KINDS[pane.kind];
  return (
    <ArtifactErrorBoundary fallback={<ArtifactMessage>Unable to load this view.</ArtifactMessage>}>
      {/* Suspense covers a lazily-loaded content chunk; the boundary covers a failed load. */}
      <Suspense fallback={<ArtifactSkeleton />}>
        <Content pane={pane} artifact={artifact} />
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
