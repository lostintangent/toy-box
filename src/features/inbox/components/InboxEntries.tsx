import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Circle, FileText, Inbox as InboxIcon, Info, Loader2, Trash2 } from "lucide-react";
import { SessionPreview, useSessionPreview } from "@sessions/components/SessionPreview";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { DestructiveConfirmationDialog } from "@/shared/components/sidebar/DestructiveConfirmationDialog";
import { useDispatchWorkspaceAction, useWorkspaceSessionActivity } from "@workspace/hooks/state";
import { cn } from "@/shared/utils";
import { createEditorPaneId, type EditorWorkspacePane } from "@workspace/model/panes";
import { sessionFile } from "@files/model";
import type { SessionMetadata } from "@sessions/model";
import type { InboxEntry } from "../model";
import { inboxMutations } from "../mutations";

export function InboxEntries({
  entries,
  sessions,
  linkedEditorPane,
  onArtifactSelect,
}: {
  entries: InboxEntry[];
  sessions: SessionMetadata[];
  linkedEditorPane?: EditorWorkspacePane;
  onArtifactSelect: (entry: InboxEntry) => void;
}) {
  const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]));

  return (
    <section aria-labelledby="workspace-inbox-heading" className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 id="workspace-inbox-heading" className="flex items-center gap-2 text-sm font-medium">
          <InboxIcon className="h-4 w-4 text-muted-foreground" />
          Inbox
        </h2>
      </div>
      {entries.length === 0 ? (
        <p className="px-1 py-2 text-sm italic text-muted-foreground">
          When you run tasks above, their results will appear here.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          {entries.map((entry) => (
            <InboxEntryRow
              key={entry.id}
              entry={entry}
              session={sessionsById.get(entry.id)}
              linked={
                entry.artifact !== undefined &&
                linkedEditorPane?.id === createEditorPaneId(sessionFile(entry.id, entry.artifact))
              }
              onSelect={() => onArtifactSelect(entry)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function InboxEntryRow({
  entry,
  session,
  linked,
  onSelect,
}: {
  entry: InboxEntry;
  session?: SessionMetadata;
  linked: boolean;
  onSelect: () => void;
}) {
  const deleteMutation = useMutation(inboxMutations.deleteEntry(entry.id));
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { running, unread } = useWorkspaceSessionActivity(entry.id);
  const dispatchWorkspaceAction = useDispatchWorkspaceAction();
  const pending = entry.message === undefined;
  const preview = useSessionPreview(!pending || !session);
  const label = entry.message || session?.summary;

  return (
    <>
      <div
        className={cn(
          "group/inbox flex items-center border-b text-sm transition-colors last:border-b-0 hover:bg-muted/50",
          pending && "bg-muted/30",
          linked && "bg-muted/60",
        )}
      >
        <SessionPreview sessionId={entry.id} {...preview}>
          <button
            type="button"
            aria-label={label ? undefined : "Loading inbox entry"}
            aria-pressed={entry.artifact ? linked : undefined}
            onClick={() => {
              preview.close();
              if (unread) dispatchWorkspaceAction({ type: "session.read", sessionId: entry.id });
              onSelect();
            }}
            onMouseEnter={preview.onMouseEnter}
            onMouseLeave={preview.onMouseLeave}
            className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left"
          >
            {entry.artifact ? (
              <FileText
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground",
                  linked && "text-primary",
                )}
              />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            {label ? (
              <span
                className={cn(
                  "whitespace-pre-wrap break-words",
                  pending && "italic text-muted-foreground",
                )}
              >
                {label}
              </span>
            ) : (
              <Skeleton className="mt-0.5 h-4 w-3/5 max-w-80" />
            )}
          </button>
        </SessionPreview>
        <InboxEntryAction
          label={label}
          running={running}
          unread={unread}
          deleting={deleteMutation.isPending}
          onDelete={() => {
            if (entry.artifact) setDeleteOpen(true);
            else deleteMutation.mutate();
          }}
        />
      </div>
      {deleteOpen && (
        <DestructiveConfirmationDialog
          title="Delete inbox entry?"
          description="This will permanently delete this inbox entry and its attached artifact. This action cannot be undone."
          mutation={inboxMutations.deleteEntry(entry.id)}
          onOpenChange={setDeleteOpen}
        />
      )}
    </>
  );
}

function InboxEntryAction({
  label,
  running,
  unread,
  deleting,
  onDelete,
}: {
  label?: string;
  running: boolean;
  unread: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const hasStatus = running || unread;
  const statusLabel = label || "Inbox entry";
  return (
    <div className="relative mr-2 h-8 w-8 shrink-0">
      {hasStatus && (
        <div
          className="absolute inset-0 flex items-center justify-center transition-opacity group-hover/inbox:opacity-0 group-focus-within/inbox:opacity-0"
          aria-label={running ? `${statusLabel} is running` : `${statusLabel} has unread activity`}
        >
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Circle className="h-2.5 w-2.5 fill-unread text-unread" />
          )}
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={deleting}
        aria-label={label ? `Delete inbox entry: ${label}` : "Delete inbox entry"}
        className={cn(
          "absolute inset-0 h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive",
          hasStatus &&
            "pointer-events-none opacity-0 transition-opacity group-hover/inbox:pointer-events-auto group-hover/inbox:opacity-100 group-focus-within/inbox:pointer-events-auto group-focus-within/inbox:opacity-100",
        )}
        onClick={onDelete}
      >
        {deleting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}
