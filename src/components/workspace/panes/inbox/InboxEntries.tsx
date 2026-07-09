import { useState } from "react";
import { useAtomValue } from "jotai";
import { Circle, FileText, Inbox as InboxIcon, Info, Loader2, Trash2 } from "lucide-react";
import { deleteInboxEntry } from "@/functions/workspace";
import {
  SessionPreview,
  useSessionPreview,
} from "@/components/workspace/panes/session/SessionPreview";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWorkspaceActions } from "@/hooks/workspace/WorkspaceActionsContext";
import { sessionRunningAtom, sessionUnreadAtom } from "@/hooks/workspace/atoms";
import { cn } from "@/lib/utils";
import type { ArtifactWorkspacePane } from "@/lib/workspace/panes";
import type { InboxEntry, SessionMetadata } from "@/types";

export function InboxEntries({
  entries,
  sessions,
  linkedArtifactPane,
  onArtifactSelect,
  onArtifactRemoved,
}: {
  entries: InboxEntry[];
  sessions: SessionMetadata[];
  linkedArtifactPane?: ArtifactWorkspacePane;
  onArtifactSelect: (entry: InboxEntry) => void;
  onArtifactRemoved: (entryId: string) => void;
}) {
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);

  const sessionsById = new Map(sessions.map((session) => [session.sessionId, session]));
  const deleteEntry = entries.find((entry) => entry.id === deleteEntryId) ?? null;

  const removeEntry = async (entryId: string) => {
    setDeletingEntryId(entryId);
    try {
      await deleteInboxEntry({ data: { entryId } });
      onArtifactRemoved(entryId);
      if (deleteEntryId === entryId) setDeleteEntryId(null);
    } catch (error) {
      console.error(`Failed to delete inbox entry ${entryId}:`, error);
    }
    setDeletingEntryId((current) => (current === entryId ? null : current));
  };

  return (
    <>
      <section aria-labelledby="workspace-inbox-heading" className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 id="workspace-inbox-heading" className="flex items-center gap-2 text-sm font-medium">
            <InboxIcon className="h-4 w-4 text-muted-foreground" />
            Inbox
          </h2>
        </div>
        {entries.length === 0 ? (
          <p className="px-1 py-2 text-sm italic text-muted-foreground">
            When you run background sessions above, their results will appear here.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            {entries.map((entry) => (
              <InboxEntryRow
                key={entry.id}
                entry={entry}
                session={sessionsById.get(entry.id)}
                linked={
                  linkedArtifactPane?.sourceSessionId === entry.id &&
                  linkedArtifactPane.path === entry.artifact
                }
                deleting={deletingEntryId === entry.id}
                onSelect={() => onArtifactSelect(entry)}
                onDelete={() => {
                  if (entry.artifact) setDeleteEntryId(entry.id);
                  else void removeEntry(entry.id);
                }}
              />
            ))}
          </div>
        )}
      </section>
      <InboxDeleteDialog
        entry={deleteEntry}
        onClose={() => setDeleteEntryId(null)}
        onDelete={() => {
          if (deleteEntry) void removeEntry(deleteEntry.id);
        }}
      />
    </>
  );
}

function InboxEntryRow({
  entry,
  session,
  linked,
  deleting,
  onSelect,
  onDelete,
}: {
  entry: InboxEntry;
  session?: SessionMetadata;
  linked: boolean;
  deleting: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const running = useAtomValue(sessionRunningAtom(entry.id));
  const unread = useAtomValue(sessionUnreadAtom(entry.id));
  const { dispatchWorkspaceAction } = useWorkspaceActions();
  const pending = entry.message === undefined;
  const preview = useSessionPreview(!pending || !session);
  const label = entry.message || session?.summary;

  return (
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
        deleting={deleting}
        onDelete={onDelete}
      />
    </div>
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

function InboxDeleteDialog({
  entry,
  onClose,
  onDelete,
}: {
  entry: InboxEntry | null;
  onClose: () => void;
  onDelete: () => void;
}) {
  if (!entry?.artifact) return null;

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete inbox entry?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this inbox entry and its attached artifact. This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
