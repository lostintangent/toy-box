import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useEditorDisplay } from "@files/components/editor/kinds";
import { workspaceFileId, type WorkspaceFile } from "@files/model";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { createEditorPaneId } from "@workspace/model/panes";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { cn } from "@/shared/utils";

export const outputPillClassName =
  "inline-flex max-w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground";

export const emptyOutputPillClassName = `${outputPillClassName} pointer-events-none opacity-60`;

/** Whether an artifact's editor pane is showing, and whether a worker is writing the file. */
export function useArtifactState(file: WorkspaceFile): { open: boolean; busy: boolean } {
  const { panes } = useWorkspaceSurface();
  const paneId = createEditorPaneId(file);
  const fileId = workspaceFileId(file);
  const busy = useWorkspaceSelector((workspace) =>
    workspace.workers.some(
      (worker) => worker.type === "file" && workspaceFileId(worker.file) === fileId,
    ),
  );
  return { open: panes.some((pane) => pane.id === paneId), busy };
}

export function ArtifactPill({
  file,
  label,
  detail,
  className,
  ...props
}: ComponentProps<"button"> & {
  file: WorkspaceFile;
  label?: string;
  /** Trails the label, such as when the artifact was shared. */
  detail?: ReactNode;
}) {
  const { name, Icon } = useEditorDisplay(file);
  const { open, busy } = useArtifactState(file);

  return (
    <button
      {...props}
      type="button"
      title={file.path}
      aria-current={open || undefined}
      className={cn(outputPillClassName, open && "bg-accent/15 text-foreground", className)}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <ScrollableFade className="flex whitespace-nowrap">
        <span className="shrink-0">{label ?? name}</span>
      </ScrollableFade>
      {detail && <span className="ms-auto shrink-0 ps-2">{detail}</span>}
    </button>
  );
}
