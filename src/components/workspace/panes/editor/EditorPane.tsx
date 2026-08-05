import { Component, Suspense, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useFile } from "@/hooks/files/useFile";
import { useWorkspaceSurface } from "@/hooks/workspace/layout/surface";
import type { EditorWorkspacePane } from "@/lib/workspace/panes";
import { createFileBaseUri } from "@/lib/files/html";
import { useEditorKind, type EditorProps, type EditorKind } from "./kinds";
import type { PaneVariant } from "../WorkspacePaneView";
import { PaneActions, PaneStatus } from "../shell/PaneSlots";
import { WorkersMenu } from "../shell/WorkersMenu";
import { EditorActions } from "./actions";

type EditorPaneProps = {
  pane: EditorWorkspacePane;
  variant?: PaneVariant;
};

/** Composes one workspace file's lifecycle — content, workers, actions, and renderer. */
export function EditorPane({ pane, variant = "normal" }: EditorPaneProps) {
  const { panePublications } = useWorkspaceSurface();
  const { file, title, mode } = pane;
  const kind = useEditorKind(file.path);
  const { editable = true } = kind;
  const { workers, spawnWorker, cancelWorker, ...fileState } = useFile(file, mode);
  const baseUri =
    typeof window === "undefined" ? undefined : createFileBaseUri(file, window.location.origin);
  const { error, isLoading, isSaving, isReady } = fileState;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {workers.length > 0 && (
        <PaneStatus>
          <WorkersMenu workers={workers} onCancelWorker={cancelWorker} variant={variant} />
        </PaneStatus>
      )}
      {(editable || isSaving) && (
        <PaneActions>
          <EditorActions
            editable={editable}
            mode={mode}
            isSaving={isSaving}
            onModeChange={(nextMode) => panePublications.actions.setEditorPaneMode(pane, nextMode)}
            variant={variant}
          />
        </PaneActions>
      )}
      {isReady && error && <EditorBanner>{error}</EditorBanner>}
      <div className="min-h-0 flex-1">
        {isLoading ? (
          <EditorSkeleton />
        ) : isReady ? (
          <EditorContent
            kind={kind}
            title={title}
            mode={mode}
            variant={variant}
            baseUri={baseUri}
            definition={kind.definition}
            file={fileState}
            pendingWorkers={workers}
            spawnWorker={spawnWorker}
          />
        ) : (
          <EditorMessage>{error ?? "Unable to load this file."}</EditorMessage>
        )}
      </div>
    </div>
  );
}

function EditorContent({ kind, ...props }: EditorProps & { kind: EditorKind }) {
  const { Renderer } = kind;
  return (
    <EditorErrorBoundary fallback={<EditorMessage>Unable to load this view.</EditorMessage>}>
      <Suspense fallback={<EditorSkeleton />}>
        <Renderer {...props} />
      </Suspense>
    </EditorErrorBoundary>
  );
}

class EditorErrorBoundary extends Component<
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

function EditorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-b bg-background px-3 py-2 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="space-y-3 p-6">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

function EditorMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
