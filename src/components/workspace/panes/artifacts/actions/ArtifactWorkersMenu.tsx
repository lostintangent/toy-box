import { useState } from "react";
import { Clock3, Loader2, Square, Trash2 } from "lucide-react";
import { InputGroupButton } from "@/components/ui/input-group";
import { MetadataBadge } from "@/components/ui/metadata-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  SessionPreview,
  useSessionPreview,
} from "@/components/workspace/panes/session/SessionPreview";
import { useWorkspaceSessionRunning } from "@/hooks/workspace/state";
import type { ArtifactWorker } from "@/types";
import { PANE_OVERLAY_BUTTON_CLASS, PANE_OVERLAY_ICON_CLASS } from "../../paneControls";
import type { PaneVariant } from "../../types";

/** Lists one artifact's pending workers and previews live sessions without
 * exposing session presentation to the artifact renderer. */
export function ArtifactWorkersMenu({
  workers,
  onCancelWorker,
  variant,
}: {
  workers: ArtifactWorker[];
  onCancelWorker: (workerSessionId: string) => Promise<void>;
  variant: PaneVariant;
}) {
  if (workers.length === 0) return null;

  const label = `${workers.length} active artifact worker${workers.length === 1 ? "" : "s"}`;
  const trigger =
    variant === "normal" ? (
      <button
        type="button"
        aria-label={label}
        title={label}
        className={cn(PANE_OVERLAY_BUTTON_CLASS, "relative")}
      >
        <Loader2 className={cn(PANE_OVERLAY_ICON_CLASS, "animate-spin")} aria-hidden />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[8px] font-semibold leading-none tabular-nums text-foreground"
        >
          {workers.length}
        </span>
      </button>
    ) : (
      <MetadataBadge
        asChild
        className="min-w-5 cursor-pointer select-none self-center justify-center tabular-nums hover:bg-secondary/80"
      >
        <button type="button" aria-label={label} title={label}>
          {workers.length}
        </button>
      </MetadataBadge>
    );

  return (
    <Popover modal>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-64 p-1"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div role="list" aria-label="Active artifact workers">
          {workers.map((worker, index) => (
            <ArtifactWorkerItem
              key={worker.sessionId}
              worker={worker}
              index={index}
              onCancel={onCancelWorker}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ArtifactWorkerItem({
  worker,
  index,
  onCancel,
}: {
  worker: ArtifactWorker;
  index: number;
  onCancel: (workerSessionId: string) => Promise<void>;
}) {
  const [cancelling, setCancelling] = useState(false);
  const running = useWorkspaceSessionRunning(worker.sessionId);
  const preview = useSessionPreview(!running);
  const name = worker.name ?? `Worker ${index + 1}`;
  const action = running ? "Stop" : "Delete queued";

  async function handleCancel() {
    if (cancelling) return;
    preview.close();
    setCancelling(true);
    try {
      await onCancel(worker.sessionId);
    } catch (error) {
      console.error("Failed to cancel artifact worker:", error);
    }
    setCancelling(false);
  }

  return (
    <SessionPreview sessionId={worker.sessionId} {...preview}>
      <div
        role="listitem"
        onMouseEnter={preview.onMouseEnter}
        onMouseLeave={preview.onMouseLeave}
        className="flex items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent"
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <Clock3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <InputGroupButton
          size="icon-xs"
          aria-label={`${action} ${name}`}
          title={`${action} worker`}
          disabled={cancelling}
          className="size-5 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onMouseEnter={(event) => {
            event.stopPropagation();
            preview.close();
          }}
          onClick={(event) => {
            event.stopPropagation();
            void handleCancel();
          }}
        >
          {cancelling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : running ? (
            <Square className="h-4 w-4" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </InputGroupButton>
      </div>
    </SessionPreview>
  );
}
