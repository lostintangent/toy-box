import { Component, Suspense, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { useArtifact } from "@/hooks/artifacts/useArtifact";
import type { ArtifactWorkspacePane, ArtifactPaneMode } from "@/lib/workspace/panes";
import { useArtifactKind, type ArtifactContentProps, type ArtifactKind } from "./kinds";
import type { PaneProps } from "../types";
import { ArtifactActions } from "./actions";

type ArtifactPaneProps = PaneProps & {
  pane: ArtifactWorkspacePane;
  onModeChange?: (pane: ArtifactWorkspacePane, mode: ArtifactPaneMode) => void;
};

/** The host-facing artifact pane. It owns the artifact lifecycle (load/save/watch), the
 *  loading / error states, and its own title-bar actions (saving indicator + mode menu),
 *  which it declares — styled by `variant` — into the host's actions slot when one is
 *  provided. Both hosts provide a slot: the grid's hover overlay ("normal" variant, icon
 *  buttons) and the pager's title bar ("compact" variant, labeled badge). With no slot it
 *  stays content-only. */
export function ArtifactPane({
  pane,
  onModeChange,
  variant = "normal",
  actionsSlot,
}: ArtifactPaneProps) {
  const kind = useArtifactKind(pane.path);
  const artifact = useArtifact({
    sessionId: pane.sourceSessionId,
    path: pane.path,
    mode: pane.mode,
    usesPreview: kind.usesPreview,
  });
  const { error, isLoading, isSaving, isReady } = artifact;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Read-only kinds can't be edited, so their mode switcher and saving indicator would
          be inert — omit the title-bar actions entirely for them. Editable by default. */}
      {actionsSlot &&
        kind.editable !== false &&
        createPortal(
          <ArtifactActions
            pane={pane}
            isSaving={isSaving}
            onModeChange={onModeChange}
            variant={variant}
          />,
          actionsSlot,
        )}
      {/* A non-fatal error (e.g. a failed save or watch) shown above still-readable content. */}
      {isReady && error && <ArtifactBanner>{error}</ArtifactBanner>}
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <ArtifactSkeleton />
        ) : isReady ? (
          <ArtifactContent kind={kind} pane={pane} artifact={artifact} />
        ) : (
          <ArtifactMessage>{error ?? "Unable to load this artifact."}</ArtifactMessage>
        )}
      </div>
    </div>
  );
}

function ArtifactContent({ kind, pane, artifact }: ArtifactContentProps & { kind: ArtifactKind }) {
  const { Component: Content } = kind;
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
